import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {initial,decide} from "./harness.ts";
import {artifact} from "./store.ts";
import {bindApproval,checkApprovals,scenarioIds,validateBrowserQA,validateBuildReviews} from "./workflow-contract.ts";

function fixture(run:(root:string,put:(name:string,data:any)=>string)=>void) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"workflow-contract-")));
 const dir="docs/development/feature/";mkdirSync(join(root,dir),{recursive:true});
 const put=(name:string,data:any)=>{const path=dir+name;writeFileSync(join(root,path),typeof data==="string"?data:JSON.stringify(data));return path;};
 try{run(root,put);}finally{rmSync(root,{recursive:true,force:true});}
}

test("design and plan bind actual files; changes invalidate approval and revision clears hashes",()=>fixture((root,put)=>{
 const doc=put("design.md","Approved flow"),html=put("index.html","<button>Invite</button>"),css=put("styles.css","button {color: red}"),qa=put("qa.md","QA-E2E-001\nThen: invitation visible\n");
 const d=put("design.json",{kind:"design",surface:"web",document:doc,mockup:{provider:"Claude Design",invocation:"/claude-design",entry:html,files:[html,css]}});
 const p=put("plan.json",{kind:"plan",surface:"web",implementation:doc,qaPlan:qa});
 const s=initial("feature");s.phase="design-gate";s.approvedArtifacts={design:bindApproval(root,"design",d),plan:bindApproval(root,"plan",p)};
 checkApprovals(root,s);
 put("styles.css","button {color: blue}");expect(()=>checkApprovals(root,s)).toThrow("Approved mockup");
 put("styles.css","button {color: red}");put("qa.md","QA-E2E-002\nThen: different assertion\n");expect(()=>checkApprovals(root,s)).toThrow();
 const revised=decide(s,"revise","Changed flow requested");expect(revised.approvedArtifacts).toEqual({});
}));

test("UI design cannot pass with a remote URL alone or escaped files",()=>fixture((root,put)=>{
 const doc=put("design.md","design");
 let p=put("design.json",{kind:"design",surface:"web",document:doc,mockup:{url:"https://example.invalid/mockup"}});
 expect(()=>bindApproval(root,"design",p)).toThrow("mockup");
 writeFileSync(join(root,"outside.html"),"outside docs");symlinkSync(join(root,"outside.html"),join(root,"docs/development/feature/link.html"));
 p=put("design.json",{kind:"design",surface:"web",document:doc,mockup:{provider:"Claude",invocation:"/design",entry:"docs/development/feature/link.html",files:["docs/development/feature/link.html"]}});
 expect(()=>bindApproval(root,"design",p)).toThrow("escaping symlinks");
}));

test("QA accepts only a distinct Codex worker and complete actual scenario evidence",()=>fixture((root,put)=>{
 const impl=put("plan.md","Implementation"),qa=put("qa.md","QA-E2E-001\nThen: Invite visible\nQA-NEG-001\nThen: Error visible\n| QA-REG-001 | existing route | P1 |\nQA-EDGE-001 [withdrawn] no longer in scope\n");
 const p=put("plan.json",{kind:"plan",surface:"web",implementation:impl,qaPlan:qa});
 const build=put("build.json",{tasks:[{dispatch:"implementation-session"}]});
 const proof=put("proof.md","Navigated localhost, clicked Invite, observed result, screenshot saved.");
 const s=initial("feature");s.approvedArtifacts={plan:bindApproval(root,"plan",p)};s.evidence.plan=p+"#sha256="+artifact(root,p).hash;s.evidence.build=build+"#sha256="+artifact(root,build).hash;
 const r={executor:"codex",role:"browser-qa",dispatch:"qa-session",freshSession:true,browser:{tool:"playwright-mcp",session:"qa-browser",preflight:"PASS",evidence:proof},scenarios:scenarioIds(artifact(root,qa).text).map(id=>({id,url:"http://localhost:3000",result:"PASS",expected:"expected text",actual:"observed text",evidence:proof}))};
 validateBrowserQA(root,s,r);
 expect(()=>validateBrowserQA(root,s,{...r,executor:"claude"})).toThrow("Independent codex");
 expect(()=>validateBrowserQA(root,s,{...r,dispatch:"implementation-session"})).toThrow();
 expect(()=>validateBrowserQA(root,s,{...r,freshSession:false})).toThrow();
 expect(()=>validateBrowserQA(root,s,{...r,notApplicable:"skip"})).toThrow("cannot skip");
 expect(()=>validateBrowserQA(root,s,{...r,scenarios:r.scenarios.slice(1)})).toThrow("Missing");
 expect(()=>validateBrowserQA(root,s,{...r,scenarios:[r.scenarios[0],r.scenarios[0],r.scenarios[2]]})).toThrow("duplicate");
 for(const result of ["FAIL","BLOCKED","NOT_RUN"])expect(()=>validateBrowserQA(root,s,{...r,scenarios:r.scenarios.map(x=>({...x,result}))})).toThrow();
 expect(()=>validateBrowserQA(root,s,{...r,browser:{...r.browser,evidence:"docs/development/feature/missing.md"}})).toThrow();
 expect(()=>validateBrowserQA(root,s,{...r,scenarios:r.scenarios.map(x=>({...x,actual:""}))})).toThrow();
}));

test("non-UI exemption is approved in advance and cannot conceal claimed browser runs",()=>fixture((root,put)=>{
 const doc=put("plan.md","CLI"),qa=put("qa.md","QA-E2E-001\nThen: CLI exits 0"),p=put("plan.json",{kind:"plan",surface:"non-ui",implementation:doc,qaPlan:qa,nonUiReason:"CLI only"});
 const s=initial("feature");s.approvedArtifacts={plan:bindApproval(root,"plan",p)};s.evidence.plan=p;s.evidence.build=put("build.json",{tasks:[{dispatch:"impl"}]});
 const r={executor:"codex",role:"browser-qa",dispatch:"qa",freshSession:true,notApplicable:"CLI only"};
 validateBrowserQA(root,s,r);
 expect(()=>validateBrowserQA(root,s,{...r,notApplicable:"I did not test"})).toThrow();
 expect(()=>validateBrowserQA(root,s,{...r,scenarios:[{id:"QA-E2E-001",result:"PASS"}]})).toThrow();
}));

test("task code review requires fresh Codex reviewer distinct from every implementer",()=>{
 const t={dispatch:"impl-1",reviewer:{executor:"codex",role:"code-review",dispatch:"review-1",freshSession:true}};
 validateBuildReviews({tasks:[t]});
 expect(()=>validateBuildReviews({tasks:[{...t,reviewer:{...t.reviewer,role:"browser-qa"}}]})).toThrow();
 expect(()=>validateBuildReviews({tasks:[{...t,reviewer:{...t.reviewer,freshSession:false}}]})).toThrow();
 expect(()=>validateBuildReviews({tasks:[{...t,reviewer:{...t.reviewer,executor:"claude"}}]})).toThrow();
 expect(()=>validateBuildReviews({tasks:[t,{dispatch:"review-1",reviewer:{...t.reviewer,dispatch:"review-2"}}]})).toThrow();
});

import type { State } from "./harness.ts";
import { artifact } from "./store.ts";

const text=(x:unknown):x is string=>typeof x==="string"&&!!x.trim();
export function scenarioIds(markdown:string):string[] {
 const ids:string[]=[];
 for(const line of markdown.split(/\r?\n/)) {
  if(line.includes("[withdrawn]"))continue;
  const m=line.match(/^\s*(?:\|\s*)?(QA-(?:E2E|NEG|EDGE|REG)-\d{3})\b/);
  if(m&&!ids.includes(m[1]!))ids.push(m[1]!);
 }
 return ids.sort();
}
export function bindApproval(root:string,phase:string,path:string):Record<string,string> {
 const b=JSON.parse(artifact(root,path).text);
 if(b.kind!==phase||!["web","non-ui"].includes(b.surface))throw Error("Expected design/plan approval bundle with web or non-ui surface");
 const files:string[]=phase==="design"?[b.document]:[b.implementation,b.qaPlan];
 if(phase==="design"&&b.surface==="web") {
  if(!text(b.mockup?.provider)||!text(b.mockup?.invocation)||!text(b.mockup?.entry)||!Array.isArray(b.mockup?.files)||!b.mockup.files.includes(b.mockup.entry))throw Error("UI design requires a Claude mockup entry, files, provider and actual invocation");
  files.push(...b.mockup.files);
 }
 if(b.surface==="non-ui"&&!text(b.nonUiReason))throw Error("Approved non-UI rationale required");
 if(files.some(p=>!text(p)))throw Error("Approval bundle contains missing document paths");
 const hashes:Record<string,string>={};
 for(const p of new Set(files))hashes[p]=artifact(root,p).hash;
 if(phase==="plan"&&!scenarioIds(artifact(root,b.qaPlan).text).length)throw Error("QA plan requires stable QA-E2E/NEG/EDGE/REG scenario IDs, including non-UI tests");
 return hashes;
}
export function checkApprovals(root:string,s:State):void {
 for(const [phase,hashes] of Object.entries(s.approvedArtifacts??{})) {
  const [bundle,hash]=s.evidence[phase]?.split("#sha256=")??[];
  if(bundle&&hash&&artifact(root,bundle).hash!==hash)throw Error("Approved bundle changed; revise its gate: "+bundle);
  for(const [p,h] of Object.entries(hashes))if(artifact(root,p).hash!==h)throw Error("Approved mockup/QA/implementation document changed; revise its gate: "+p);
 }
}
export function approvedPlan(root:string,s:State):any {
 checkApprovals(root,s);
 const p=s.evidence.plan?.split("#sha256=")[0];
 if(!p||!s.approvedArtifacts?.plan)throw Error("Approved plan bundle required");
 const plan=JSON.parse(artifact(root,p).text);
 if(plan.kind!=="plan")throw Error("Approved plan bundle required");
 return plan;
}
export function validateIndependent(r:any,executor:"claude"|"codex",implementationDispatches:string[]):void {
 if(r.executor!==executor||r.role!==(executor==="claude"?"code-review":"browser-qa")||!text(r.dispatch)||r.freshSession!==true||implementationDispatches.includes(r.dispatch))
  throw Error("Independent "+executor+" worker requires a fresh distinct dispatch and correct role");
}
export function implementationDispatches(root:string,s:State):string[] {
 const p=s.evidence.build?.split("#sha256=")[0];
 if(!p)throw Error("Approved build report required before independent review/QA");
 const report=JSON.parse(artifact(root,p).text);
 return (report.tasks??[]).map((t:any)=>t.dispatch);
}
export function validateBrowserQA(root:string,s:State,r:any):void {
 const plan=approvedPlan(root,s);
 validateIndependent(r,"codex",implementationDispatches(root,s));
 if(plan.surface==="non-ui") {
  if(!text(r.notApplicable)||r.notApplicable!==plan.nonUiReason||r.scenarios?.length)throw Error("Non-UI exemption must match approved plan and contain no claimed browser runs");
  return;
 }
 if(r.notApplicable)throw Error("A web plan cannot skip browser QA");
 if(r.browser?.preflight!=="PASS"||!text(r.browser?.tool)||!text(r.browser?.evidence)||!text(r.browser?.session))throw Error("Actual browser preflight evidence required from the QA worker");
 artifact(root,r.browser.evidence);
 const expected=scenarioIds(artifact(root,plan.qaPlan).text);
 if(!Array.isArray(r.scenarios)||r.scenarios.length!==expected.length||new Set(r.scenarios.map((x:any)=>x.id)).size!==expected.length)throw Error("Missing or duplicate approved QA scenarios");
 for(const x of r.scenarios) {
  if(!expected.includes(x.id)||x.result!=="PASS"||!text(x.expected)||!text(x.actual)||!text(x.url)||!/^https?:\/\//.test(x.url)||!text(x.evidence))throw Error("Every approved QA scenario must actually PASS with URL, expected/actual and evidence");
  artifact(root,x.evidence);
 }
}
export function validateBuildReviews(r:any):void {
 for(const t of r.tasks??[]) {
  if(!text(t.dispatch))throw Error("Implementation dispatch required");
  validateIndependent(t.reviewer??{},"claude",r.tasks.map((x:any)=>x.dispatch));
 }
}

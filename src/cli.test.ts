import { repositoryGate, repositoryCommit } from "./repository-control.ts";
import { test,expect,setDefaultTimeout } from "bun:test";
// These tests drive real git repositories and spawn the CLI dozens of times; the 5s
// default is too tight once the machine is busy, and a timeout here says nothing about
// the harness. Unit tests elsewhere keep the default.
setDefaultTimeout(30_000);
// Never read the developer's own agent configuration.
process.env.HARNESS_CONFIG_HOME=mkdtempSync(join(tmpdir(),"harness-person-empty-"));
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git,load,save,fingerprint,codeRoot } from "./store.ts";
import { initial } from "./harness.ts";
test("CLI blocks wrong phase, detects changed approved docs, and records the worktree",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-cli-"));const root=join(base,"repo"),wt=join(base,"worktree");mkdirSync(root);
 const cli=(...args:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...args],{cwd:root});
 try {
  git(root,"init");git(root,"config","user.email","test@example.invalid");git(root,"config","user.name","Test");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  expect(cli("setup").exitCode).toBe(0);
  expect(cli("configure",'[["bun","test"]]').exitCode).toBe(0);
  expect(cli("init","sample").exitCode).toBe(0);
  const dir=join(root,"docs/development/sample");
  writeFileSync(join(dir,"product.md"),"reviewable product");
  expect(cli("complete","design","docs/development/sample/product.md").exitCode).toBe(1);
  expect(cli("complete","brainstorm","docs/development/sample/product.md").exitCode).toBe(0);
  writeFileSync(join(dir,"product.md"),"changed after submission");
  expect(cli("decide","approve","human reference").exitCode).toBe(1);
  expect(cli("decide","revise","human revision").exitCode).toBe(0);
  writeFileSync(join(dir,"qa.md"),"QA-E2E-001\nGiven: CLI fixture\nWhen: run\nThen: exits 0\n");
  writeFileSync(join(dir,"design.json"),JSON.stringify({kind:"design",surface:"non-ui",document:"docs/development/sample/product.md",nonUiReason:"CLI fixture, no browser surface"}));
  writeFileSync(join(dir,"plan.json"),JSON.stringify({kind:"plan",surface:"non-ui",implementation:"docs/development/sample/product.md",qaPlan:"docs/development/sample/qa.md",nonUiReason:"CLI fixture, no browser surface"}));
  for(const phase of ["brainstorm","design","plan"]){
   expect(cli("complete",phase,"docs/development/sample/"+(phase==="brainstorm"?"product.md":phase+".json")).exitCode).toBe(0);
   expect(cli("decide","approve","human reference").exitCode).toBe(0);
  }
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({mode:"claude-only",verificationCommands:[["echo","changed"]]}));
  expect(cli("worktree",wt,"feature/sample").stderr.toString()).toContain("configuration changed");
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]]},null,2)+"\n");
  expect(cli("worktree",wt,"feature/sample").exitCode).toBe(1);
  git(root,"add","docs","harness.config.json");git(root,"commit","-m","plan");
  expect(cli("worktree",wt,"feature/sample").exitCode).toBe(0);
  expect(load(root).phase).toBe("build");expect(load(root).worktree).toBe(realpathSync(wt));
  expect(load(root).worktreeBranch).toBe("feature/sample");
  expect(existsSync(join(wt,".harness/state.json"))).toBe(false);
  expect(cli("plan","--execute").exitCode).toBe(1);
  const run=(...args:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...args],{cwd:root});
  writeFileSync(join(wt,"task.txt"),"verified task implementation\n");
  writeFileSync(join(root,".harness/worker.json"),JSON.stringify({task:"T1",executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture RED",evidence:"expected assertion failure"},green:{status:"passed",command:"fixture GREEN",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:["task.txt"],proposed_commit_message:"feat: task",notes:[]}));
  writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["task.txt"]}));
  const commit=repositoryCommit(root,repositoryGate(root,".harness/worker.json",".harness/scope.json").token);
  const reportPath="docs/development/sample/delivery.json";
  const report={verdict:"PASS",head:git(wt,"rev-parse","HEAD"),fingerprint:fingerprint(wt),commands:[{command:"fixture assertion",exitCode:0}],findings:[],tasks:[{...commit,review_commit:commit.commit.sha,review_verdict:"PASS",id:"T1",executor:"codex",dispatch:"fixture Codex execution log",red:"fixture red",green:"fixture green",review:"independent fixture review",reviewer:{executor:"codex",role:"code-review",dispatch:"task-review-session",freshSession:true}}],notApplicable:"CLI fixture, no browser surface"};
  writeFileSync(join(wt,reportPath),JSON.stringify(report));
  writeFileSync(join(wt,reportPath),JSON.stringify({...report,tasks:report.tasks.map(t=>({...t,executor:"claude"}))}));
  expect(run("complete","build",reportPath).exitCode).toBe(1);
  writeFileSync(join(wt,reportPath),JSON.stringify(report));
  for(const phase of ["build","review","browser-qa","verification"]) {
   const phasePath="docs/development/sample/"+phase+".json";
   const metadata=phase==="review"?{executor:"codex",role:"code-review",dispatch:"whole-review-session",freshSession:true}:phase==="browser-qa"?{executor:"codex",role:"browser-qa",dispatch:"qa-session",freshSession:true}:{};
   writeFileSync(join(wt,phasePath),JSON.stringify({...report,...metadata}));
   const result=run("complete",phase,phasePath);expect(result.stderr.toString()).toBe("");expect(result.exitCode).toBe(0);
  }
  expect(run("complete","finish",reportPath).exitCode).toBe(1);
  expect(run("decide","approve","fixture UAT").exitCode).toBe(0);
  git(wt,"add","docs");git(wt,"commit","-m","evidence");
  expect(run("complete","finish",reportPath).exitCode).toBe(0);
  expect(load(root).phase).toBe("done");
 }finally{rmSync(base,{recursive:true,force:true});}
});

const workerReport=(task:string,files:string[])=>JSON.stringify({task,executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture RED",evidence:"expected assertion failure"},green:{status:"passed",command:"fixture GREEN",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:files,proposed_commit_message:"feat: fixture",notes:[]});
const seed=(base:string)=>{
 const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
 writeFileSync(join(root,".gitignore"),".harness/\n");
 mkdirSync(join(root,"docs/development/sample"),{recursive:true});
 writeFileSync(join(root,"docs/development/sample/product.md"),"reviewable product");
 writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]]},null,2));
 writeFileSync(join(root,"source.ts"),"export const a=1;\n");
 git(root,"add",".");git(root,"commit","-m","initial");
 return {root,wt};
};
test("delivery fingerprints come from the worktree, not the main checkout",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-route-"));
 try{
  const {root,wt}=seed(base);
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const s=initial("sample");s.root=realpathSync(root);s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";
  expect(codeRoot(root,s)).toBe(realpathSync(wt));
  const before=fingerprint(codeRoot(root,s));
  writeFileSync(join(wt,"source.ts"),"export const a=2;\n");
  expect(fingerprint(codeRoot(root,s))).not.toBe(before);
  expect(fingerprint(root)).toBe(before);
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("controller commits land in the worktree and never move main",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-commit-"));
 try{
  const {root,wt}=seed(base);
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const mainHead=git(root,"rev-parse","HEAD");
  const s=initial("sample");s.root=realpathSync(root);s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";s.phase="build";save(root,s);
  writeFileSync(join(wt,"task.txt"),"work\n");
  writeFileSync(join(root,".harness/worker.json"),workerReport("T1",["task.txt"]));
  writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["task.txt"]}));
  const entry=repositoryCommit(root,repositoryGate(root,".harness/worker.json",".harness/scope.json").token);
  expect(git(wt,"rev-parse","HEAD")).toBe(entry.commit.sha);
  expect(git(root,"rev-parse","HEAD")).toBe(mainHead);
  expect(git(wt,"rev-parse","--abbrev-ref","HEAD")).toBe("feature/x");
  expect(existsSync(join(root,".harness/repository-ledger.json"))).toBe(true);
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("delivery refuses a missing worktree or the wrong branch",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-guard-"));
 try{
  const {root,wt}=seed(base);
  const bare=initial("sample");bare.root=realpathSync(root);bare.phase="build";save(root,bare);
  writeFileSync(join(root,".harness/worker.json"),workerReport("T1",["task.txt"]));
  writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["task.txt"]}));
  expect(()=>repositoryGate(root,".harness/worker.json",".harness/scope.json")).toThrow("worktree");
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const wrong=initial("sample");wrong.root=realpathSync(root);wrong.worktree=realpathSync(wt);wrong.worktreeBranch="feature/other";wrong.phase="build";save(root,wrong);
  expect(()=>repositoryGate(root,".harness/worker.json",".harness/scope.json")).toThrow("approved branch");
  const self=initial("sample");self.root=realpathSync(root);self.worktree=realpathSync(root);self.worktreeBranch="feature/x";self.phase="build";save(root,self);
  expect(()=>repositoryGate(root,".harness/worker.json",".harness/scope.json")).toThrow("main checkout");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("a light run goes through the CLI without a design gate and can escalate",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-light-"));const root=join(base,"repo");mkdirSync(root);
 const cli=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...a],{cwd:root});
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  expect(cli("setup").exitCode).toBe(0);
  expect(cli("configure",'[["bun","test"]]').exitCode).toBe(0);
  expect(cli("init","hotfix","--track","light").exitCode).toBe(0);
  expect(load(root).track).toBe("light");
  const dir=join(root,"docs/development/hotfix");
  writeFileSync(join(dir,"brainstorm.md"),"fix label typo");
  writeFileSync(join(dir,"impl.md"),"change one string");
  writeFileSync(join(dir,"qa.md"),"QA-REG-001\nGiven: label\nWhen: render\nThen: spelled right\n");
  expect(cli("complete","brainstorm","docs/development/hotfix/brainstorm.md").exitCode).toBe(0);
  expect(load(root).phase).toBe("plan");
  const bundle=(extra:object)=>writeFileSync(join(dir,"plan.json"),JSON.stringify({kind:"plan",surface:"non-ui",implementation:"docs/development/hotfix/impl.md",qaPlan:"docs/development/hotfix/qa.md",nonUiReason:"label string only",...extra}));
  bundle({});
  expect(cli("complete","plan","docs/development/hotfix/plan.json").stderr.toString()).toContain("designNeeded");
  bundle({designNeeded:true});
  expect(cli("complete","plan","docs/development/hotfix/plan.json").stderr.toString()).toContain("designNeeded");
  bundle({designNeeded:false});
  const r=cli("complete","plan","docs/development/hotfix/plan.json");
  expect(r.stderr.toString()).toBe("");expect(r.exitCode).toBe(0);
  expect(load(root).phase).toBe("plan-gate");
  expect(cli("decide","revise","--escalate","needs mockups").exitCode).toBe(0);
  expect(load(root).track).toBe("full");expect(load(root).phase).toBe("design");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("relayed approval is recorded through the CLI and can be switched off",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-relaycli-"));
 const make=(name:string,allowRelay?:boolean)=>{
  const root=join(base,name);mkdirSync(root);
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  const cli=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...a],{cwd:root});
  expect(cli("setup").exitCode).toBe(0);
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]],...(allowRelay===undefined?{}:{approval:{allowRelay}})},null,2));
  expect(cli("init","sample").exitCode).toBe(0);
  writeFileSync(join(root,"docs/development/sample/product.md"),"reviewable product");
  expect(cli("complete","brainstorm","docs/development/sample/product.md").exitCode).toBe(0);
  return {root,cli};
 };
 try{
  const on=make("on");
  const r=on.cli("decide","approve","--relay","좋아 진행해","conversation 12");
  expect(r.stderr.toString()).toBe("");expect(r.exitCode).toBe(0);
  expect(load(on.root).history.at(-1)!.actor).toBe("relay");
  expect(on.cli("status").stderr.toString()).toContain("relayed");
  const off=make("off",false);
  const denied=off.cli("decide","approve","--relay","좋아 진행해","conversation 12");
  expect(denied.exitCode).toBe(1);expect(denied.stderr.toString()).toContain("allowRelay");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("plan completion pins the engines for the rest of the run",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-pin-"));const root=join(base,"repo"),home=join(base,"home");mkdirSync(root);mkdirSync(home);
 const cli=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...a],{cwd:root,env:{...process.env,HARNESS_CONFIG_HOME:home}});
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  expect(cli("setup").exitCode).toBe(0);
  expect(cli("configure",'[["bun","test"]]').exitCode).toBe(0);
  writeFileSync(join(home,"agents.json"),JSON.stringify({agents:{implementer:{engine:"gemini",dispatch:{kind:"shell",command:["gemini","-y","-p","{{prompt}}"]}}}}));
  expect(cli("init","pin","--track","light").exitCode).toBe(0);
  const dir=join(root,"docs/development/pin");
  writeFileSync(join(dir,"b.md"),"b");writeFileSync(join(dir,"i.md"),"i");writeFileSync(join(dir,"q.md"),"QA-REG-001\nGiven: a\nWhen: b\nThen: c\n");
  writeFileSync(join(dir,"plan.json"),JSON.stringify({kind:"plan",surface:"non-ui",implementation:"docs/development/pin/i.md",qaPlan:"docs/development/pin/q.md",nonUiReason:"none",designNeeded:false}));
  expect(cli("complete","brainstorm","docs/development/pin/b.md").exitCode).toBe(0);
  const r=cli("complete","plan","docs/development/pin/plan.json");expect(r.stderr.toString()).toBe("");
  expect(load(root).agents!.agents.implementer.engine).toBe("gemini");
  writeFileSync(join(home,"agents.json"),JSON.stringify({}));
  expect(load(root).agents!.agents.implementer.engine).toBe("gemini");
 }finally{rmSync(base,{recursive:true,force:true});}
});

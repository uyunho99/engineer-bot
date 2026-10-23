import {test,expect,setDefaultTimeout} from "bun:test";
// Real git worktrees per test; keep clear of the 5s default on a busy machine.
setDefaultTimeout(30_000);
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {git,save} from "./store.ts";
import {initial,type State} from "./harness.ts";
import {dispatchSpec} from "./dispatch.ts";
import {requirements} from "./doctor.ts";
import {loadAgents} from "./agents.ts";

process.env.HARNESS_CONFIG_HOME=mkdtempSync(join(tmpdir(),"harness-person-empty-"));
process.env.HARNESS_WATCH="off";

const world=(fn:(w:{root:string;wt:string;state:(p:Partial<State>)=>State})=>void)=>{
 const base=mkdtempSync(join(tmpdir(),"harness-dispatch-"));const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]]},null,2));
  git(root,"add",".");git(root,"commit","-m","initial");
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const state=(p:Partial<State>)=>{const s={...initial("sample"),root:realpathSync(root),worktree:realpathSync(wt),worktreeBranch:"feature/x",phase:"build",...p} as State;save(root,s);return s;};
  fn({root,wt,state});
 }finally{rmSync(base,{recursive:true,force:true});}
};

test("dispatch is refused outside its phase and without a fixed scope",()=>world(({root,state})=>{
 state({phase:"plan-gate"});
 expect(()=>dispatchSpec(root,"implementer","T1")).toThrow("belongs to build");
 state({});
 expect(()=>dispatchSpec(root,"implementer","T1")).toThrow("--files");
 expect(()=>dispatchSpec(root,"designer","T1")).toThrow("Role must be");
}));

test("implementer dispatch fixes the scope, writes the prompt and follows the configured engine",()=>world(({root,wt,state})=>{
 state({});
 const spec=dispatchSpec(root,"implementer","T1",["src/a.ts","src/a.test.ts"]);
 expect(spec.invocation).toMatchObject({kind:"claude-agent",agent:"codex:codex-rescue"});
 expect(spec.cwd).toBe(realpathSync(wt));
 expect(JSON.parse(readFileSync(join(root,".harness/scope.json"),"utf8"))).toEqual({task:"T1",allowed_files:["src/a.ts","src/a.test.ts"]});
 const prompt=readFileSync(spec.promptFile,"utf8");
 expect(prompt).toContain("READY_FOR_COMMIT");expect(prompt).toContain("executor value in that report is: codex");expect(prompt).toContain("Test first.");expect(prompt).toContain("src/a.ts, src/a.test.ts");expect(prompt).toContain(realpathSync(wt));
 expect(dispatchSpec(root,"implementer","T1").scope).toEqual({task:"T1",allowed_files:["src/a.ts","src/a.test.ts"]});
 writeFileSync(join(wt,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]],agents:{implementer:{engine:"gemini",dispatch:{kind:"shell",command:["gemini","-y","--prompt-file","{{promptFile}}"]}}}}));
 const g=dispatchSpec(root,"implementer","T1");
 expect(g.engine).toBe("gemini");
 expect(g.invocation).toEqual({kind:"shell",command:["gemini","-y","--prompt-file",g.promptFile]});
}));

test("the implementer waits for worktree preparation",()=>world(({root,state})=>{
 state({});
 writeFileSync(join(root,".harness/worktree-prepare.json"),JSON.stringify({state:"running"}));
 expect(()=>dispatchSpec(root,"implementer","T1",["a.ts"])).toThrow("preparation is running");
 writeFileSync(join(root,".harness/worktree-prepare.json"),JSON.stringify({state:"ok"}));
 expect(dispatchSpec(root,"implementer","T1",["a.ts"]).scope!.task).toBe("T1");
}));

test("the approved plan section for the task travels with the prompt",()=>world(({root,wt,state})=>{
 const dir=join(wt,"docs/development/sample");mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,"impl.md"),"# Plan\n\n### Task 1: Parse input\n\nDo the parsing.\n\n#### Step 1\n\nwrite test\n\n### Task 2: Render\n\nNot this one.\n");
 writeFileSync(join(dir,"plan.json"),JSON.stringify({kind:"plan",implementation:"docs/development/sample/impl.md"}));
 state({evidence:{plan:"docs/development/sample/plan.json#sha256=fixture"}});
 const spec=dispatchSpec(root,"implementer","T1",["a.ts"]);
 expect(spec.planExcerpt).toContain("Task 1: Parse input");
 expect(spec.planExcerpt).toContain("#### Step 1");
 expect(spec.planExcerpt).not.toContain("Task 2");
 expect(readFileSync(spec.promptFile,"utf8")).toContain("Do the parsing.");
 expect(dispatchSpec(root,"implementer","T9",["a.ts"]).planExcerpt).toBeNull();
}));

test("a reviewer is pointed at the fixed commit, never the working tree",()=>world(({root,state})=>{
 state({});
 expect(()=>dispatchSpec(root,"reviewer","T1")).toThrow("No controller commit");
 writeFileSync(join(root,".harness/repository-ledger.json"),JSON.stringify([{run_id:"sample",task:"T1",base_commit:"aaa111",commit:{sha:"bbb222"}}]));
 const spec=dispatchSpec(root,"reviewer","T1");
 expect(spec.scope).toBeNull();
 expect(readFileSync(spec.promptFile,"utf8")).toContain("git diff aaa111..bbb222");
 expect(readFileSync(spec.promptFile,"utf8")).toContain("Review only");
 expect(existsSync(join(root,".harness/scope.json"))).toBe(false);
}));

test("doctor requires only what the configured engines need",()=>{
 const home=mkdtempSync(join(tmpdir(),"harness-doctor-")),root=mkdtempSync(join(tmpdir(),"harness-doctor-proj-"));
 const prev=process.env.HARNESS_CONFIG_HOME;process.env.HARNESS_CONFIG_HOME=home;
 try{
  const d=requirements(loadAgents(root));
  expect(d.executables).toEqual(["bun","claude","codex","git"]);expect(d.codexPlugin).toBe(true);expect(d.codexBrowserSkill).toBe(true);
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({agents:{
   implementer:{engine:"gemini",dispatch:{kind:"shell",command:["gemini","-y","-p","{{prompt}}"]}},
   reviewer:{engine:"claude",dispatch:{kind:"claude-agent",agent:"general-purpose",readOnly:true}},
   browserQa:{engine:"claude",dispatch:{kind:"claude-agent",agent:"general-purpose"}}}}));
  const g=requirements(loadAgents(root));
  expect(g.executables).toEqual(["bun","claude","gemini","git"]);expect(g.codexPlugin).toBe(false);expect(g.codexBrowserSkill).toBe(false);
 }finally{
  if(prev===undefined)delete process.env.HARNESS_CONFIG_HOME;else process.env.HARNESS_CONFIG_HOME=prev;
  rmSync(home,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});
 }
});
test("whole-branch review starts where the worktree left main",()=>world(({root,state})=>{
 state({phase:"review",worktreeBase:"ccc333"});
 expect(readFileSync(dispatchSpec(root,"reviewer","branch").promptFile,"utf8")).toContain("git diff ccc333..HEAD");
}));

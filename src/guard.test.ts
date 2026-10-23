import {test,expect,setDefaultTimeout} from "bun:test";
// Real git worktrees and CLI processes; keep clear of the 5s default on a busy machine.
setDefaultTimeout(30_000);
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,existsSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {git,save,load} from "./store.ts";
import {initial} from "./harness.ts";
import {repositoryGate,repositoryCommit,validateTaskCommits} from "./repository-control.ts";
import {recordViolation,unacknowledged} from "./guard.ts";
import {scanOnce,startWatcher} from "./watch.ts";
import {installPrecommit,guardReport} from "./precommit.ts";

process.env.HARNESS_CONFIG_HOME=mkdtempSync(join(tmpdir(),"harness-person-empty-"));
// Tests start the watcher only where they mean to.
process.env.HARNESS_WATCH="off";

const report=(task:string,files:string[])=>JSON.stringify({task,executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture RED",evidence:"expected assertion failure"},green:{status:"passed",command:"fixture GREEN",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:files,proposed_commit_message:"feat: "+task,notes:[]});
const reviewed=(e:any)=>({...e,id:e.task,review_commit:e.commit.sha,review_verdict:"PASS",review:"independent fixture review"});

const split=async(fn:(root:string,wt:string)=>void|Promise<void>)=>{
 const base=mkdtempSync(join(tmpdir(),"harness-ledger-"));const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\nbuild/\n");writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"harness",verificationCommands:[["bun","test"]]}));
  git(root,"add",".");git(root,"commit","-m","initial");
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  git(wt,"config","user.email","t@example.invalid");git(wt,"config","user.name","T");
  const s=initial("sample");s.root=realpathSync(root);s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";s.worktreeBase=git(wt,"rev-parse","HEAD");s.phase="build";save(root,s);
  await fn(root,wt);
 }finally{rmSync(base,{recursive:true,force:true});}
};
const gated=(root:string,wt:string,task:string,file:string)=>{
 writeFileSync(join(wt,file),task+"\n");
 writeFileSync(join(root,".harness/worker.json"),report(task,[file]));
 writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task,allowed_files:[file]}));
 return repositoryCommit(root,repositoryGate(root,".harness/worker.json",".harness/scope.json").token);
};

test("a product commit that skipped the repository gate is refused even with the hook off",()=>split((root,wt)=>{
 writeFileSync(join(wt,"rogue.ts"),"export const sneaky=1;\n");git(wt,"add","rogue.ts");git(wt,"commit","-m","controller wrote code");
 const t1=gated(root,wt,"T1","one.ts");
 expect(()=>validateTaskCommits(root,[reviewed(t1)])).toThrow("not in the controller ledger");
}));

test("evidence-only commits outside the ledger are allowed",()=>split((root,wt)=>{
 mkdirSync(join(wt,"docs/development/sample"),{recursive:true});
 writeFileSync(join(wt,"docs/development/sample/notes.md"),"notes\n");git(wt,"add","docs");git(wt,"commit","-m","evidence");
 const t1=gated(root,wt,"T1","one.ts");
 validateTaskCommits(root,[reviewed(t1)]);
}));

test("unacknowledged violations block complete and decide, and an acknowledgement needs a reason",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-banner-"));const root=join(base,"repo");mkdirSync(root);
 const cli=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...a],{cwd:root});
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  expect(cli("setup").exitCode).toBe(0);expect(cli("configure",'[["bun","test"]]').exitCode).toBe(0);expect(cli("init","sample").exitCode).toBe(0);
  writeFileSync(join(root,"docs/development/sample/product.md"),"product");
  expect(cli("complete","brainstorm","docs/development/sample/product.md").exitCode).toBe(0);
  recordViolation(root,{paths:["src/parser.ts"],phase:"product-gate",task:null});
  const status=cli("status");expect(status.exitCode).toBe(0);expect(status.stderr.toString()).toContain("src/parser.ts");
  const refused=cli("decide","approve","looks good");
  expect(refused.exitCode).toBe(1);expect(refused.stderr.toString()).toContain("guard --ack");
  expect(load(root).phase).toBe("product-gate");
  expect(cli("guard","--ack","").exitCode).toBe(1);
  expect(cli("guard","--ack","reverted the stray edit").exitCode).toBe(0);
  const ack=load(root).history.at(-1)!;
  expect(ack.action).toBe("guard-ack");expect(ack.reference).toBe("reverted the stray edit");expect(ack.actor).toBe("controller");
  expect(unacknowledged(root,load(root))).toEqual([]);
  expect(cli("status").stderr.toString()).not.toContain("src/parser.ts");
  expect(cli("decide","approve","looks good").exitCode).toBe(0);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test("the watcher records source changes nobody was dispatched to make, once per content",()=>split((root,wt)=>{
 writeFileSync(join(wt,"stray.ts"),"x\n");
 const seen=new Set<string>();
 expect(scanOnce(root,seen)?.paths).toEqual(["stray.ts"]);
 expect(scanOnce(root,seen)).toBeNull();
 writeFileSync(join(wt,"stray.ts"),"y\n");
 expect(scanOnce(root,seen)?.paths).toEqual(["stray.ts"]);
 expect(unacknowledged(root,load(root)).length).toBe(2);
}));

test("in-scope work, ignored output and development artifacts are not violations",()=>split((root,wt)=>{
 writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["one.ts"]}));
 writeFileSync(join(wt,"one.ts"),"ok\n");
 mkdirSync(join(wt,"build"));writeFileSync(join(wt,"build/out.js"),"x");
 mkdirSync(join(wt,"docs/development/sample"),{recursive:true});writeFileSync(join(wt,"docs/development/sample/r.json"),"{}");
 expect(scanOnce(root,new Set())).toBeNull();
}));

test("a committed task's scope is spent, so later edits to its files are flagged",()=>split((root,wt)=>{
 gated(root,wt,"T1","one.ts");
 expect(existsSync(join(root,".harness/scope.json"))).toBe(false);
 writeFileSync(join(wt,"one.ts"),"controller edit\n");
 expect(scanOnce(root,new Set())?.paths).toEqual(["one.ts"]);
}));

test("the pre-commit hook refuses out-of-scope commits and lets gated and evidence commits through",()=>split((root,wt)=>{
 expect(installPrecommit(root,load(root))).toBe("installed");
 writeFileSync(join(wt,"rogue.ts"),"x\n");git(wt,"add","rogue.ts");
 expect(()=>git(wt,"commit","-m","rogue")).toThrow("outside");
 git(wt,"reset","-q","rogue.ts");rmSync(join(wt,"rogue.ts"));
 expect(gated(root,wt,"T1","one.ts").commit.sha).toBe(git(wt,"rev-parse","HEAD"));
 mkdirSync(join(wt,"docs/development/sample"),{recursive:true});writeFileSync(join(wt,"docs/development/sample/n.md"),"n");
 git(wt,"add","docs");git(wt,"commit","-m","evidence");
 git(root,"commit","--allow-empty","-m","main is untouched by the guard");
}));

test("pre-commit installation stands aside for core.hooksPath and foreign hooks, and says so",()=>split((root)=>{
 git(root,"config","core.hooksPath",".githooks");
 const viaPath=installPrecommit(root,load(root));expect(viaPath).toContain("core.hooksPath");
 git(root,"config","--unset","core.hooksPath");
 const hooks=join(realpathSync(root),".git/hooks");mkdirSync(hooks,{recursive:true});
 writeFileSync(join(hooks,"pre-commit"),"#!/bin/sh\nexit 0\n",{mode:0o755});
 const foreign=installPrecommit(root,load(root));expect(foreign).toContain("existing pre-commit");
 expect(readFileSync(join(hooks,"pre-commit"),"utf8")).toBe("#!/bin/sh\nexit 0\n");
 const s=load(root);s.precommit=foreign;save(root,s);
 expect(guardReport(root).precommit).toContain("existing pre-commit");
}));

test("a started watcher notices a stray edit on its own",async()=>split(async(root,wt)=>{
 const prev=process.env.HARNESS_WATCH;delete process.env.HARNESS_WATCH;
 try{
  startWatcher(root,load(root));
  expect(JSON.parse(readFileSync(join(root,".harness/watch.json"),"utf8")).pid).toBeGreaterThan(0);
  writeFileSync(join(wt,"stray.ts"),"x\n");
  let found=false;
  for(let i=0;i<40&&!found;i++){await Bun.sleep(500);found=unacknowledged(root,load(root)).some(v=>v.paths.includes("stray.ts"));}
  expect(found).toBe(true);
 }finally{
  process.env.HARNESS_WATCH=prev;
  try{process.kill(JSON.parse(readFileSync(join(root,".harness/watch.json"),"utf8")).pid);}catch{}
 }
}),60_000);

import { repositoryGate, repositoryCommit } from "./repository-control.ts";
import { test,expect } from "bun:test";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git,load,fingerprint } from "./store.ts";
test("CLI blocks wrong phase, detects changed approved docs, and transfers an isolated run",()=>{
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
  expect(load(root).phase).toBe("transferred");expect(load(wt).phase).toBe("build");expect(load(wt).worktree).toBe(realpathSync(wt));
  expect(cli("plan","--execute").exitCode).toBe(1);
  const run=(...args:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...args],{cwd:wt});
  writeFileSync(join(wt,"task.txt"),"verified task implementation\n");
  writeFileSync(join(wt,".harness/worker.json"),JSON.stringify({task:"T1",executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture RED",evidence:"expected assertion failure"},green:{status:"passed",command:"fixture GREEN",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:["task.txt"],proposed_commit_message:"feat: task",notes:[]}));
  writeFileSync(join(wt,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["task.txt"]}));
  const commit=repositoryCommit(wt,repositoryGate(wt,".harness/worker.json",".harness/scope.json").token);
  const reportPath="docs/development/sample/delivery.json";
  const report={verdict:"PASS",head:git(wt,"rev-parse","HEAD"),fingerprint:fingerprint(wt),commands:[{command:"fixture assertion",exitCode:0}],findings:[],tasks:[{...commit,review_commit:commit.commit.sha,review_verdict:"PASS",id:"T1",executor:"codex",dispatch:"fixture Codex execution log",red:"fixture red",green:"fixture green",review:"independent fixture review",reviewer:{executor:"claude",role:"code-review",dispatch:"task-review-session",freshSession:true}}],notApplicable:"CLI fixture, no browser surface"};
  writeFileSync(join(wt,reportPath),JSON.stringify(report));
  writeFileSync(join(wt,reportPath),JSON.stringify({...report,tasks:report.tasks.map(t=>({...t,executor:"claude"}))}));
  expect(run("complete","build",reportPath).exitCode).toBe(1);
  writeFileSync(join(wt,reportPath),JSON.stringify(report));
  for(const phase of ["build","review","browser-qa","verification"]) {
   const phasePath="docs/development/sample/"+phase+".json";
   const metadata=phase==="review"?{executor:"claude",role:"code-review",dispatch:"whole-review-session",freshSession:true}:phase==="browser-qa"?{executor:"codex",role:"browser-qa",dispatch:"qa-session",freshSession:true}:{};
   writeFileSync(join(wt,phasePath),JSON.stringify({...report,...metadata}));
   const result=run("complete",phase,phasePath);expect(result.stderr.toString()).toBe("");expect(result.exitCode).toBe(0);
  }
  expect(run("complete","finish",reportPath).exitCode).toBe(1);
  expect(run("decide","approve","fixture UAT").exitCode).toBe(0);
  git(wt,"add","docs");git(wt,"commit","-m","evidence");
  expect(run("complete","finish",reportPath).exitCode).toBe(0);
  expect(load(wt).phase).toBe("done");
 }finally{rmSync(base,{recursive:true,force:true});}
});

import { test, expect, setDefaultTimeout } from "bun:test";
// These tests drive real git repositories and spawn the CLI dozens of times; the 5s
// default is too tight once the machine is busy, and a timeout here says nothing about
// the harness. Unit tests elsewhere keep the default.
setDefaultTimeout(30_000);
// Never read the developer's own agent configuration.
process.env.HARNESS_CONFIG_HOME=mkdtempSync(join(tmpdir(),"harness-person-empty-"));
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, save } from "./store.ts";
import { initial } from "./harness.ts";
import { repositoryGate, repositoryCommit, validateTaskCommits, validateWorker, changedFiles } from "./repository-control.ts";

function fixture(run:(main:string,root:string,report:(paths:string[],task?:string)=>void)=>void) {
 const dir=realpathSync(mkdtempSync(join(tmpdir(),"repository-control-"))), main=join(dir,"main"),root=join(dir,"worktree");mkdirSync(main);
 try {
  git(main,"init");git(main,"config","user.email","test@example.invalid");git(main,"config","user.name","Controller fixture");
  writeFileSync(join(main,".gitignore"),".harness/\n");writeFileSync(join(main,"app.txt"),"before\n");
  git(main,"add","--",".gitignore","app.txt");git(main,"commit","-m","base");git(main,"worktree","add","-b","fixture",root);
  const s=initial("fixture");s.phase="build";s.root=realpathSync(main);s.worktree=root;s.worktreeBranch="fixture";save(main,s);
  const report=(paths:string[],task="T1")=>{
   writeFileSync(join(main,".harness/worker.json"),JSON.stringify({task,executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture failing assertion",evidence:"expected after, got before"},green:{status:"passed",command:"fixture passing assertion",tests_passed:1},typecheck:{status:"passed",command:"fixture static validation"}},changed_files:paths,proposed_commit_message:"feat: fixture",notes:[]}));
   writeFileSync(join(main,".harness/scope.json"),JSON.stringify({task,allowed_files:paths}));
  };
  run(main,root,report);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const gate=(main:string)=>repositoryGate(main,".harness/worker.json",".harness/scope.json");
const reviewed=(entry:any)=>({...entry,id:entry.task,review_commit:entry.commit.sha,review_verdict:"PASS",review:"independent fixture review"});

test("linked worktree lifecycle commits only through Controller and rechecks immutable fix",()=>fixture((main,root,report)=>{
 const base=git(root,"rev-parse","HEAD");expect(readFileSync(join(root,".git"),"utf8")).toContain("gitdir:");
 writeFileSync(join(root,"app.txt"),"after\n");report(["app.txt"]);
 expect(git(root,"rev-parse","HEAD")).toBe(base);
 const preview=gate(main),first=repositoryCommit(main,preview.token);
 expect(first.base_commit).toBe(base);expect(first.committer).toBe("controller");expect(changedFiles(root)).toEqual([]);
 expect(git(root,"diff",base+".."+first.commit.sha)).toContain("+after");
 validateTaskCommits(main,[reviewed(first)]);
 expect(()=>validateTaskCommits(main,[{...reviewed(first),review_verdict:"FAIL"}])).toThrow();
 writeFileSync(join(root,"app.txt"),"review fix\n");report(["app.txt"]);
 expect(()=>validateTaskCommits(main,[reviewed(first)])).toThrow("Uncommitted");
 const fix=repositoryCommit(main,gate(main).token);
 expect(fix.base_commit).toBe(first.commit.sha);
 expect(()=>validateTaskCommits(main,[reviewed(first)])).toThrow("latest controller");
 validateTaskCommits(main,[reviewed(fix)]);
 expect(JSON.parse(readFileSync(join(main,".harness/repository-ledger.json"),"utf8"))).toHaveLength(2);
}));

test("gate refuses unexpected, sensitive, already staged and stale changes without committing",()=>fixture((main,root,report)=>{
 const base=git(root,"rev-parse","HEAD");writeFileSync(join(root,"app.txt"),"after\n");report(["app.txt"]);
 writeFileSync(join(root,"unexpected-script.sh"),"echo unexpected\n");expect(()=>gate(main)).toThrow("Unexpected");rmSync(join(root,"unexpected-script.sh"));
 writeFileSync(join(root,".env"),"TOKEN=fixture\n");report(["app.txt",".env"]);expect(()=>gate(main)).toThrow("Sensitive");rmSync(join(root,".env"));report(["app.txt"]);
 const old=gate(main);writeFileSync(join(root,"app.txt"),"changed after gate\n");expect(()=>repositoryCommit(main,old.token)).toThrow("stale");
 git(root,"add","--","app.txt");expect(()=>gate(main)).toThrow("Pre-existing staged");
 expect(git(root,"rev-parse","HEAD")).toBe(base);
}));

test("exact staging includes deletions, rename endpoints and literal pathspec names",()=>fixture((main,root,report)=>{
 renameSync(join(root,"app.txt"),join(root,"renamed file.txt"));writeFileSync(join(root,":(glob)*"),"literal\n");
 const paths=["app.txt","renamed file.txt",":(glob)*"];report(paths);
 const entry=repositoryCommit(main,gate(main).token);
 expect(entry.changed_files).toEqual([...paths].sort());expect(changedFiles(root)).toEqual([]);
 expect(git(root,"show",entry.commit.sha+":renamed file.txt")).toBe("before");
}));

test("worker schema rejects implementation failure, fake RED and incomplete verification",()=>fixture((main,root,report)=>{
 writeFileSync(join(root,"app.txt"),"after\n");report(["app.txt"]);
 const r=JSON.parse(readFileSync(join(main,".harness/worker.json"),"utf8"));validateWorker(r);
 expect(()=>validateWorker({...r,status:"BLOCKED"})).toThrow();
 expect(()=>validateWorker({...r,verification:{...r.verification,red:{status:"passed",command:"test"}}})).toThrow();
 expect(()=>validateWorker({...r,verification:{...r.verification,lint:{status:"failed",command:"lint"}}})).toThrow();
}));


test("gate preserves approved configuration and rejects commit-hook mutations",()=>fixture((main,root,report)=>{
 writeFileSync(join(root,"app.txt"),"after\n");report(["app.txt"]);
 const s=initial("fixture");s.phase="build";s.root=realpathSync(main);s.worktree=root;s.worktreeBranch="fixture";
 save(main,{...s,configHash:"wrong hash"} as typeof s);
 writeFileSync(join(root,"harness.config.json"),"{}");
 expect(()=>gate(main)).toThrow("configuration changed");rmSync(join(root,"harness.config.json"));save(main,s);
 const hooks=join(root,".harness/hooks");mkdirSync(hooks,{recursive:true});
 writeFileSync(join(hooks,"pre-commit"),'#!/bin/sh\nprintf "hook mutation\\n" > app.txt\ngit add -- app.txt\n',{mode:0o755});
 git(root,"config","core.hooksPath",hooks);
 expect(()=>repositoryCommit(main,gate(main).token)).toThrow("hook changed contents");
 expect(()=>validateTaskCommits(main,[{id:"T1"}])).toThrow("latest controller");
}));

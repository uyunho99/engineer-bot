import { checkApprovals } from "./workflow-contract.ts";
import { readFileSync, writeFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { git, digest, load, artifact, codeRoot } from "./store.ts";
import type { State } from "./harness.ts";
import { runAgents } from "./agents.ts";

export const workerInstruction = "Do not create Git commits. Complete the implementation and verification, then return READY_FOR_COMMIT with the exact changed-file list and a proposed commit message. Repository state transitions are owned by the controller.";
export type WorkerReport = {
 task:string; executor:string; status:"READY_FOR_COMMIT";
 implementation:{status:"complete"};
 verification:Record<string,{status:string;command:string;evidence?:string;tests_passed?:number}>;
 changed_files:string[]; proposed_commit_message:string; notes:string[];
};
function nonempty(v:unknown):v is string {return typeof v==="string"&&!!v.trim();}
function files(v:unknown):string[] {
 if(!Array.isArray(v)||!v.length||v.some(p=>!nonempty(p)||p.startsWith("/")||p.split("/").some((s:string)=>!s||s===".."||s===".")||p.includes("\0")||p.startsWith(".git/")||p===".git"||p.startsWith(".harness/"))||new Set(v).size!==v.length)throw Error("Exact, unique repository-relative files required");
 return [...v].sort();
}
function same(a:string[],b:string[]):boolean{return JSON.stringify([...a].sort())===JSON.stringify([...b].sort());}
export function validateWorker(r:any,engines:string[]=["codex","claude"]):asserts r is WorkerReport {
 if(!r||!nonempty(r.task)||!engines.includes(r.executor)||r.status!=="READY_FOR_COMMIT"||r.implementation?.status!=="complete"||!nonempty(r.proposed_commit_message)||!Array.isArray(r.notes)||r.notes.some((n:unknown)=>typeof n!=="string"))throw Error("Expected complete READY_FOR_COMMIT worker report");
 files(r.changed_files);
 const v=r.verification;
 if(!v||v.red?.status!=="passed"||!nonempty(v.red.evidence)||v.green?.status!=="passed"||!Number.isInteger(v.green.tests_passed)||v.green.tests_passed<1||v.typecheck?.status!=="passed")throw Error("Passing RED evidence, GREEN test count and typecheck required");
 for(const check of Object.values(v) as any[])if(check.status!=="passed"||!nonempty(check.command))throw Error("All required verification must pass with command evidence");
}
function raw(root:string,...args:string[]):string {
 const r=Bun.spawnSync(["git","-C",root,...args],{stdout:"pipe",stderr:"pipe"});
 if(r.exitCode)throw Error(r.stderr.toString());return r.stdout.toString();
}
export function changedFiles(root:string):string[] {
 return [...new Set([...raw(root,"diff","--name-only","--no-renames","-z","HEAD").split("\0"),...raw(root,"ls-files","--others","--exclude-standard","-z").split("\0")].filter(Boolean))].sort();
}
function snapshot(stateRoot:string,root:string,reportPath:string,scopePath:string) {
 const report=JSON.parse(readFileSync(resolve(stateRoot,reportPath),"utf8"));validateWorker(report,[runAgents(root,load(stateRoot)).agents.implementer.engine]);
 const scope=JSON.parse(readFileSync(resolve(stateRoot,scopePath),"utf8"));
 if(scope.task!==report.task)throw Error("Scope task mismatch");
 const allowed=files(scope.allowed_files), actual=changedFiles(root);
 if(!same(actual,report.changed_files)||actual.some(p=>!allowed.includes(p)))throw Error("Unexpected/missing files: reconcile actual diff, report and controller-owned scope");
 if(raw(root,"diff","--cached","--name-only").trim())throw Error("Pre-existing staged changes: reconcile index before gate");
 for(const p of actual){
  if(/(^|\/)(\.env(?:\..*)?|credentials?(?:[./]|$))|\.(pem|key|p12)$/i.test(p))throw Error("Sensitive file requires separate explicit controller review: "+p);
  const full=resolve(root,p);
  if(existsSync(full)&&(lstatSync(full).isSymbolicLink()||!lstatSync(full).isFile()))throw Error("Symlink/submodule requires separate controller review: "+p);
 }
 raw(root,"diff","--check","HEAD");
 const state={head:git(root,"rev-parse","HEAD"),report,scope,status:raw(root,"status","--short"),diff:raw(root,"diff","--binary","HEAD"),contents:actual.map(p=>[p,existsSync(resolve(root,p))?digest(readFileSync(resolve(root,p))):"deleted"])};
 return {report,actual,state,token:digest(JSON.stringify(state))};
}
function isLinkedWorktree(dir:string):boolean {
 return realpathSync(resolve(dir,git(dir,"rev-parse","--git-dir")))!==realpathSync(resolve(dir,git(dir,"rev-parse","--git-common-dir")));
}
function requireWorktree(stateRoot:string,s:State):string {
 if(!s.worktree)throw Error("Approved build worktree required");
 const code=codeRoot(stateRoot,s);
 // Runs started before the split keep their state inside the linked worktree; only a
 // run whose state sits in the main repository may not deliver into that same tree.
 if(code===realpathSync(stateRoot)&&!isLinkedWorktree(code))throw Error("Delivery must not target the main checkout");
 if(realpathSync(git(code,"rev-parse","--show-toplevel"))!==code)throw Error("Approved worktree path is not a worktree root");
 if(git(code,"rev-parse","--abbrev-ref","HEAD")!==s.worktreeBranch)throw Error("Worktree is not on the approved branch");
 return code;
}
function requireBuild(stateRoot:string):string {
 const s=load(stateRoot);const code=requireWorktree(stateRoot,s);
 checkApprovals(code,s);if(s.phase!=="build")throw Error("Approved build worktree required");
 for(const entry of Object.values(s.evidence)) {
  const [path,hash]=entry.split("#sha256=");
  if(hash&&artifact(code,path!).hash!==hash)throw Error("Approved evidence changed; revise its gate");
 }
 const hash=(s as {configHash?:string}).configHash;
 if(hash&&digest(readFileSync(resolve(code,"harness.config.json")))!==hash)throw Error("Approved verification configuration changed");
 return code;
}
export function repositoryGate(stateRoot:string,reportPath:string,scopePath:string) {
 stateRoot=realpathSync(stateRoot);const root=requireBuild(stateRoot);
 const result=snapshot(stateRoot,root,reportPath,scopePath);
 writeFileSync(resolve(stateRoot,".harness/repository-gate.json"),JSON.stringify({reportPath,scopePath,token:result.token}));
 return {token:result.token,...result.state,changed_files:result.actual};
}
export function repositoryCommit(stateRoot:string,token:string) {
 stateRoot=realpathSync(stateRoot);const root=requireBuild(stateRoot);
 const split=root!==stateRoot, mainHead=split?git(stateRoot,"rev-parse","HEAD"):"";
 const g=JSON.parse(readFileSync(resolve(stateRoot,".harness/repository-gate.json"),"utf8"));
 const x=snapshot(stateRoot,root,g.reportPath,g.scopePath);
 if(token!==g.token||token!==x.token)throw Error("Repository gate stale; inspect a new gate before commit");
 // Literal pathspecs handle spaces, leading dashes and Git pathspec magic. Deletions
 // and both rename endpoints are staged explicitly; no blanket git add -A.
 git(root,"--literal-pathspecs","add","--",...x.actual);
 if(!same(raw(root,"diff","--cached","--name-only","--no-renames","-z").split("\0").filter(Boolean),x.actual))throw Error("Staged scope changed; inspect index, do not retry blindly");
 git(root,"diff","--cached","--check");
 for(const [p,hash] of x.state.contents) {
  if(hash!=="deleted"&&digest(Bun.spawnSync(["git","-C",root,"show",":"+p],{stdout:"pipe",stderr:"pipe"}).stdout)!==hash)throw Error("Staged content changed; inspect index before retry");
 }
 if(git(root,"rev-parse","HEAD")!==x.state.head)throw Error("HEAD changed during staging");
 git(root,"commit","-m",x.report.proposed_commit_message);
 const sha=git(root,"rev-parse","HEAD");
 if(git(root,"rev-parse",sha+"^")!==x.state.head||!same(raw(root,"diff","--name-only","--no-renames","-z",x.state.head,sha).split("\0").filter(Boolean),x.actual))throw Error("Commit hook changed scope/parent; reconcile committed result before review");
 for(const [p,hash] of x.state.contents) {
  if(hash!=="deleted"&&digest(Bun.spawnSync(["git","-C",root,"show",sha+":"+p],{stdout:"pipe",stderr:"pipe"}).stdout)!==hash)throw Error("Commit hook changed contents; reconcile committed result before review");
 }
 if(split&&git(stateRoot,"rev-parse","HEAD")!==mainHead)throw Error("Main checkout HEAD moved during a worktree commit; inspect both trees before continuing");
 const entry={run_id:load(stateRoot).id,task:x.report.task,executor:x.report.executor,committer:"controller",repository_control:{mode:"controller_managed"},base_commit:x.state.head,commit:{sha,message:x.report.proposed_commit_message},changed_files:x.actual,worker_report:x.report};
 const path=resolve(stateRoot,".harness/repository-ledger.json");
 const ledger=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):[];
 ledger.push(entry);writeFileSync(path,JSON.stringify(ledger,null,2)+"\n");
 return entry;
}
export function validateTaskCommits(stateRoot:string,tasks:any):void {
 const s=load(stateRoot);const root=codeRoot(stateRoot,s);
 if(changedFiles(root).some(p=>!p.startsWith("docs/development/")))throw Error("Uncommitted product changes cannot pass immutable review");
 if(!Array.isArray(tasks)||!tasks.length)throw Error("Controller commit ledger and immutable review required");
 const path=resolve(stateRoot,".harness/repository-ledger.json");
 const ledger=(existsSync(path)?JSON.parse(readFileSync(path,"utf8")):[]).filter((e:any)=>e.run_id===s.id);
 if(!ledger.length||git(root,"rev-parse","HEAD")!==ledger.at(-1).commit.sha)throw Error("HEAD must equal the latest controller commit");
 // HEAD matching the ledger is not enough: a commit made around the gate can sit between
 // two controller commits and every parent check still holds. Walk the whole range.
 if(s.worktreeBase) {
  const known=new Set(ledger.map((e:any)=>e.commit.sha));
  for(const sha of git(root,"rev-list","--reverse",s.worktreeBase+"..HEAD").split("\n").filter(Boolean)) {
   if(known.has(sha))continue;
   const touched=git(root,"diff","--name-only",sha+"^1",sha).split("\n").filter(Boolean);
   if(touched.some(p=>!p.startsWith("docs/development/")))throw Error("Commit "+sha.slice(0,12)+" is not in the controller ledger and changes product files; it did not go through the repository gate");
  }
 }
 for(const t of tasks){
  const entry=ledger.filter((e:any)=>e.task===t.id).at(-1);
  if(!entry||t.executor!==entry.executor||t.committer!=="controller"||t.repository_control?.mode!=="controller_managed"||t.commit?.sha!==entry.commit.sha||t.base_commit!==entry.base_commit||t.review_commit!==entry.commit.sha||t.review_verdict!=="PASS"||!nonempty(t.review))throw Error("Task requires latest controller commit and independent PASS for that immutable commit");
  if(git(root,"rev-parse",entry.commit.sha+"^")!==entry.base_commit)throw Error("Task commit parent mismatch");
  git(root,"merge-base","--is-ancestor",entry.commit.sha,"HEAD");
 }
 if(ledger.some((e:any)=>!tasks.some((t:any)=>t.id===e.task)))throw Error("Build omits a committed task");
}

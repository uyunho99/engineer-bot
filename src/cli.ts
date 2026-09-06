import { bindApproval, checkApprovals, validateBrowserQA, validateBuildReviews, validateIndependent, implementationDispatches } from "./workflow-contract.ts";
import { repositoryGate, repositoryCommit, validateTaskCommits } from "./repository-control.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initial, complete, decide, retry } from "./harness.ts";
import { repo, load, save, locked, git, artifact, fingerprint, statePath, digest } from "./store.ts";
import { setup, verificationCommands } from "./project.ts";
import { evidence } from "./evidence.ts";
import { doctor } from "./doctor.ts";
const [command,...args]=Bun.argv.slice(2);

const help="harness: repository-gate <worker-report.json> <scope.json> | repository-commit <gate-token> | doctor | setup | configure <JSON-argv-arrays> | evidence | fingerprint | init <slug> | status | complete <phase> <report> | decide <approve|revise|cancel> <human-reference> | worktree <absolute-path> <new-branch> | retry <findings>";
try {
 if(args.includes("--execute"))throw Error("Ungated execute removed: use harness lifecycle");
 if(command==="doctor") await doctor();
 else {
 const root=repo();
 if(command==="setup")setup(root);
 else if(command==="evidence")evidence(root);
 else if(command==="fingerprint")console.log(fingerprint(root));
 else if(command==="status"||command==="plan"||command==="smoke") {if(existsSync(statePath(root))) console.log(JSON.stringify(load(root),null,2));else console.log(help);}
 else await locked(root,async()=>{
  if(command==="configure") {
   if(existsSync(statePath(root)) && !["brainstorm","design","plan"].includes(load(root).phase))throw Error("Configure verification before plan approval, outside pending gates");
   const path=resolve(root,"harness.config.json");
   const config=JSON.parse(readFileSync(path,"utf8"));
   const commands=JSON.parse(args[0]??"null");
   if(!Array.isArray(commands)||!commands.length||commands.some((c:unknown)=>!Array.isArray(c)||!c.length||c.some(x=>typeof x!=="string"||!x.trim())))throw Error("Expected non-empty command argument arrays");
   writeFileSync(path,JSON.stringify({...config,verificationCommands:commands},null,2)+"\n");return;
  }
  if(command==="init") {
   if(existsSync(statePath(root)))throw Error("Existing run: resume it; archive explicitly before a new run");
   const s=initial(args[0]??"");s.root=root;s.base=git(root,"rev-parse","HEAD");save(root,s);
   mkdirSync(resolve(root,"docs/development",s.id),{recursive:true});console.log(JSON.stringify(s));return;
  }
  let s=load(root);
  if(command==="repository-gate") {console.log(JSON.stringify(repositoryGate(root,args[0]??"",args[1]??""),null,2));return;}
  if(command==="repository-commit") {console.log(JSON.stringify(repositoryCommit(root,args[0]??""),null,2));return;}
  const configPath=resolve(root,"harness.config.json");
  const configHash=()=>digest(readFileSync(configPath));
  if(s.configHash && !(command==="decide" && args[0]!=="approve") && !(command==="complete" && s.phase==="plan") && configHash()!==s.configHash)throw Error("Approved verification configuration changed; restore it or revise the plan");
  if(command==="complete") {
   const [phase,path]=args;if(!phase||!path)throw Error(help);
   if(phase==="worktree")throw Error("Use worktree command to establish isolation");
   if(phase==="plan" && existsSync(resolve(root,"harness.config.json")))verificationCommands(root);
   const report=artifact(root,path);
   if(s.workflowVersion===2) {
    checkApprovals(root,s);
    if(["design","plan"].includes(phase)) {
     const hashes=bindApproval(root,phase,path);
     if(phase==="plan") {
      const designPath=s.evidence.design?.split("#sha256=")[0];
      if(!designPath||JSON.parse(artifact(root,designPath).text).surface!==JSON.parse(report.text).surface)throw Error("Design and QA plan surfaces must agree");
     }
     s.approvedArtifacts??={};s.approvedArtifacts[phase]=hashes;
    }
   }
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(root,p!).hash!==h)throw Error("Approved evidence changed; revise/restart its gate");}
   if(["build","review","browser-qa","verification","finish"].includes(phase)) {
    if(s.worktree!==root)throw Error("Delivery must run in approved worktree");
    const r=JSON.parse(report.text) as {verdict:string;commands?:{command:string;exitCode:number}[];head:string;fingerprint:string;findings?:unknown[];notApplicable?:string;tasks?:{id:string;red:string;green:string;review:string;executor:string;dispatch:string}[];scenarios?:{id:string;result:string;evidence:string}[]};
    if(r.verdict!=="PASS"||(phase!=="finish"&&r.head!==git(root,"rev-parse","HEAD"))||r.fingerprint!==fingerprint(root))throw Error("Failed or stale report");
    if(!Array.isArray(r.findings)||r.findings.length)throw Error("Resolve all findings");
    if(phase==="build"&&(!r.tasks?.length||r.tasks.some(t=>!t.id||!t.red||!t.green||!t.review||t.executor!=="codex"||!t.dispatch?.trim())))throw Error("Per-task Codex executor/dispatch, RED/GREEN and independent review evidence required");
    if(phase==="build") {validateTaskCommits(root,r.tasks);if(s.workflowVersion===2)validateBuildReviews(r);}
    if(s.workflowVersion===2&&phase==="review")validateIndependent(r,"code-review",implementationDispatches(root,s));
    if(s.workflowVersion===2&&phase==="browser-qa")validateBrowserQA(root,s,r);
    if(phase==="browser-qa"&&!(r.notApplicable?.trim())&&(!r.scenarios?.length||r.scenarios.some(t=>!t.id||t.result!=="PASS"||!t.evidence)))throw Error("Browser scenarios or explicit non-UI rationale required");
    if(phase==="verification"||phase==="build") {if(!r.commands?.length||r.commands.some(c=>!c.command||c.exitCode!==0))throw Error("Passing command evidence required");}
    if(["browser-qa","verification","finish"].includes(phase)&&s.snapshot!==fingerprint(root))throw Error("Code changed since review; retry from build");
    if(phase==="review")s.snapshot=fingerprint(root);
    if(phase==="finish"&&git(root,"status","--porcelain"))throw Error("Commit approved changes and evidence before finish");
   }
   if(phase==="plan" && existsSync(configPath))s.configHash=configHash();
   s=complete(s,phase,path+"#sha256="+report.hash,"PASS");save(root,s);
  } else if(command==="decide") {
   if(args[0]==="approve")checkApprovals(root,s);
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(root,p!).hash!==h&&args[0]==="approve")throw Error("Gate evidence changed; revise first");}
   if(s.phase==="uat-gate"&&args[0]==="approve"&&s.snapshot!==fingerprint(root))throw Error("UAT evidence stale; retry");
   s=decide(s,args[0]??"",args[1]??"");save(root,s);
  } else if(command==="retry")save(root,retry(s,args.join(" ")));
  else if(command==="worktree") {
   if(s.phase!=="worktree")throw Error("Plan approval required");
   checkApprovals(root,s);
   const [path,branch]=args;if(!path?.startsWith("/")||!branch)throw Error(help);
   if(git(root,"status","--porcelain"))throw Error("Commit planning artifacts before creating worktree");
   git(root,"worktree","add","-b",branch,path,"HEAD");
   s=complete(s,"worktree","git worktree "+path,"PASS");s.root=git(path,"rev-parse","--show-toplevel");s.worktree=s.root;
   save(path,s);save(root,{...s,root,phase:"transferred"});console.log("Continue from "+path);
  } else throw Error(help);
 });
 }
} catch(e) {console.error(e instanceof Error?e.message:e);process.exitCode=1;}

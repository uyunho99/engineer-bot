import { bindApproval, checkApprovals, validateBrowserQA, validateBuildReviews, validateBuildTasks, validateIndependent, implementationDispatches } from "./workflow-contract.ts";
import { loadAgents, runAgents } from "./agents.ts";
import { repositoryGate, repositoryCommit, validateTaskCommits } from "./repository-control.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initial, complete, decide, retry, type Track } from "./harness.ts";
import { repo, load, save, locked, git, artifact, fingerprint, statePath, digest, codeRoot } from "./store.ts";
import { setup, verificationCommands, fixLimits, allowRelay } from "./project.ts";
import { evidence } from "./evidence.ts";
import { doctor } from "./doctor.ts";
import { startPrepare, prepareStatus } from "./prepare.ts";
import { dispatchSpec } from "./dispatch.ts";
const [command,...args]=Bun.argv.slice(2);
function parseDecide(a:string[]) {
 const ri=a.indexOf("--relay");
 const relay=ri<0?undefined:(a[ri+1]??"");
 const plain=a.filter((x,i)=>x!=="--escalate"&&(ri<0||(i!==ri&&i!==ri+1)));
 return {decision:plain[0]??"",reference:plain[1]??"",escalate:a.includes("--escalate"),relay};
}

const help="harness: repository-gate <worker-report.json> <scope.json> | repository-commit <gate-token> | doctor | setup | configure <JSON-argv-arrays> | evidence | fingerprint | init <slug> [--track full|light] | status | complete <phase> <report> | decide <approve|revise|cancel> [--escalate] [--relay <user-quote>] <reference> | worktree <absolute-path> <new-branch> | retry <findings> --task <task-id> | prepare | prepare-status | dispatch <implementer|reviewer|browserQa> <task-id> [--files a,b]";
try {
 if(args.includes("--execute"))throw Error("Ungated execute removed: use harness lifecycle");
 if(command==="doctor") await doctor();
 else {
 const root=repo();
 if(command==="setup")setup(root);
 else if(command==="evidence")evidence(root);
 else if(command==="fingerprint")console.log(fingerprint(existsSync(statePath(root))?codeRoot(root,load(root)):root));
 else if(command==="status"||command==="plan"||command==="smoke") {
  if(!existsSync(statePath(root)))console.log(help);
  else {
   const st=load(root);console.log(JSON.stringify(st,null,2));
   const relayed=st.history.filter(h=>h.actor==="relay").length;
   if(relayed)console.error(relayed+" gate decision(s) were relayed from conversation rather than entered by the operator");
  }
 }
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
   const ti=args.indexOf("--track");
   const rest=ti<0?args:[...args.slice(0,ti),...args.slice(ti+2)];
   const s=initial(rest[0]??"",(ti<0?"full":args[ti+1]??"") as Track);s.root=root;s.base=git(root,"rev-parse","HEAD");save(root,s);
   mkdirSync(resolve(root,"docs/development",s.id),{recursive:true});console.log(JSON.stringify(s));return;
  }
  let s=load(root);
  const code=codeRoot(root,s);
  if(command==="repository-gate") {console.log(JSON.stringify(repositoryGate(root,args[0]??"",args[1]??""),null,2));return;}
  if(command==="repository-commit") {console.log(JSON.stringify(repositoryCommit(root,args[0]??""),null,2));return;}
  if(command==="prepare") {
   if(!s.worktree)throw Error("Approved worktree required");
   startPrepare(root,s.worktree);console.log(JSON.stringify(prepareStatus(root)));return;
  }
  if(command==="dispatch") {
   const fi=args.indexOf("--files");
   const files=fi<0?undefined:(args[fi+1]??"").split(",").map(x=>x.trim()).filter(Boolean);
   const rest=fi<0?args:[...args.slice(0,fi),...args.slice(fi+2)];
   console.log(JSON.stringify(dispatchSpec(root,rest[0]??"",rest[1]??"",files),null,2));return;
  }
  if(command==="prepare-status") {console.log(JSON.stringify(prepareStatus(root),null,2));return;}
  const configPath=resolve(root,"harness.config.json");
  const configHash=()=>digest(readFileSync(configPath));
  if(s.configHash && !(command==="decide" && parseDecide(args).decision!=="approve") && !(command==="complete" && s.phase==="plan") && configHash()!==s.configHash)throw Error("Approved verification configuration changed; restore it or revise the plan");
  if(command==="complete") {
   const [phase,path]=args;if(!phase||!path)throw Error(help);
   if(phase==="worktree")throw Error("Use worktree command to establish isolation");
   if(phase==="plan" && existsSync(resolve(code,"harness.config.json")))verificationCommands(code);
   const report=artifact(code,path);
   if(s.workflowVersion===2) {
    checkApprovals(code,s);
    if(["design","plan"].includes(phase)) {
     const hashes=bindApproval(code,phase,path,s.track??"full");
     if(phase==="plan"&&(s.track??"full")==="full") {
      const designPath=s.evidence.design?.split("#sha256=")[0];
      if(!designPath||JSON.parse(artifact(code,designPath).text).surface!==JSON.parse(report.text).surface)throw Error("Design and QA plan surfaces must agree");
     }
     s.approvedArtifacts??={};s.approvedArtifacts[phase]=hashes;
    }
   }
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(code,p!).hash!==h)throw Error("Approved evidence changed; revise/restart its gate");}
   if(["build","review","browser-qa","verification","finish"].includes(phase)) {
    if(!s.worktree)throw Error("Delivery must run in an approved worktree");
    const team=runAgents(code,s).agents;
    if(phase==="build") {
     const prep=prepareStatus(root);
     if(!["ok","skipped"].includes(String(prep.state)))throw Error("Worktree preparation is "+String(prep.state)+"; inspect .harness/worktree-prepare.log and rerun prepare before completing build");
    }
    const r=JSON.parse(report.text) as {verdict:string;commands?:{command:string;exitCode:number}[];head:string;fingerprint:string;findings?:unknown[];notApplicable?:string;tasks?:{id:string;red:string;green:string;review:string;executor:string;dispatch:string}[];scenarios?:{id:string;result:string;evidence:string}[]};
    if(r.verdict!=="PASS"||(phase!=="finish"&&r.head!==git(code,"rev-parse","HEAD"))||r.fingerprint!==fingerprint(code))throw Error("Failed or stale report");
    if(!Array.isArray(r.findings)||r.findings.length)throw Error("Resolve all findings");
    if(phase==="build")validateBuildTasks(r,team);
    if(phase==="build") {validateTaskCommits(root,r.tasks);if(s.workflowVersion===2)validateBuildReviews(r,team.reviewer.engine);}
    if(s.workflowVersion===2&&phase==="review")validateIndependent(r,"code-review",implementationDispatches(code,s),team.reviewer.engine);
    if(s.workflowVersion===2&&phase==="browser-qa")validateBrowserQA(code,s,r,team.browserQa.engine);
    if(phase==="browser-qa"&&!(r.notApplicable?.trim())&&(!r.scenarios?.length||r.scenarios.some(t=>!t.id||t.result!=="PASS"||!t.evidence)))throw Error("Browser scenarios or explicit non-UI rationale required");
    if(phase==="verification"||phase==="build") {if(!r.commands?.length||r.commands.some(c=>!c.command||c.exitCode!==0))throw Error("Passing command evidence required");}
    if(["browser-qa","verification","finish"].includes(phase)&&s.snapshot!==fingerprint(code))throw Error("Code changed since review; retry from build");
    if(phase==="review")s.snapshot=fingerprint(code);
    if(phase==="finish"&&git(code,"status","--porcelain"))throw Error("Commit approved changes and evidence before finish");
   }
   if(phase==="plan" && existsSync(configPath))s.configHash=configHash();
   if(phase==="plan")s.agents=loadAgents(code);
   s=complete(s,phase,path+"#sha256="+report.hash,"PASS");save(root,s);
  } else if(command==="decide") {
   const {decision,reference,escalate,relay}=parseDecide(args);
   if(relay!==undefined&&!allowRelay(code))throw Error("Relayed decisions are disabled by approval.allowRelay in harness.config.json; record this decision in the operator's terminal");
   if(decision==="approve")checkApprovals(code,s);
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(code,p!).hash!==h&&decision==="approve")throw Error("Gate evidence changed; revise first");}
   if(s.phase==="uat-gate"&&decision==="approve"&&s.snapshot!==fingerprint(code))throw Error("UAT evidence stale; retry");
   s=decide(s,decision,reference,{escalate,relay});save(root,s);
  } else if(command==="retry") {
   const i=args.indexOf("--task");
   const task=i>=0?(args[i+1]??""):"";
   const findings=(i>=0?[...args.slice(0,i),...args.slice(i+2)]:args).join(" ");
   save(root,retry(s,findings,task,fixLimits(root)));
  }
  else if(command==="worktree") {
   if(s.phase!=="worktree")throw Error("Plan approval required");
   checkApprovals(code,s);
   const [path,branch]=args;if(!path?.startsWith("/")||!branch)throw Error(help);
   if(git(root,"status","--porcelain"))throw Error("Commit planning artifacts before creating worktree");
   git(root,"worktree","add","-b",branch,path,"HEAD");
   s=complete(s,"worktree","git worktree "+path,"PASS");
   s.worktree=git(path,"rev-parse","--show-toplevel");s.worktreeBranch=branch;s.worktreeBase=git(path,"rev-parse","HEAD");
   save(root,s);
   startPrepare(root,s.worktree);
   console.log("Worktree ready at "+s.worktree+"\nAdd it to this session instead of restarting: /add-dir "+s.worktree);
  } else throw Error(help);
 });
 }
} catch(e) {console.error(e instanceof Error?e.message:e);process.exitCode=1;}

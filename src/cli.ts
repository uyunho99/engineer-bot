import { sync, gateDecision, start, check, requireAccepted, type Backend, rpc } from "./orca.ts";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { initial, complete, decide, retry } from "./harness.ts";
import { repo, load, save, locked, git, artifact, fingerprint, statePath } from "./store.ts";
import { doctor } from "./doctor.ts";
const [command,...args]=Bun.argv.slice(2);
const root=repo();
const help="harness: doctor | init <slug> | status | complete <phase> <report> | decide <approve|revise|cancel> <human-reference> | worktree <absolute-path> <new-branch> | retry <findings>";
try {
 if(args.includes("--execute"))throw Error("Ungated execute removed: use harness lifecycle");
 if(command==="doctor") { await doctor(); const {contract}=await import("./orca.ts");console.log(await contract()); }
 else if(command==="status"||command==="plan"||command==="smoke") {if(existsSync(statePath(root))) console.log(JSON.stringify(load(root),null,2));else console.log(help);}
 else await locked(root,async()=>{
  if(command==="init") {
   if(existsSync(statePath(root)))throw Error("Existing run: resume it; archive explicitly before a new run");
   const s=initial(args[0]??"");s.root=root;s.base=git(root,"rev-parse","HEAD");save(root,s);
   mkdirSync(resolve(root,"docs/development",s.id),{recursive:true});console.log(JSON.stringify(s));return;
  }
  let s=load(root);
  if(command==="orca-sync") {await sync(s,root);return;}
  if(command==="orca-start") {await start(s,root,args[0]??"",args[1]??"codex",args[2]);return;}
  if(command==="orca-check") {await check(s,root,args[0]);return;}
  if(command==="complete") {
   const [phase,path]=args;if(!phase||!path)throw Error(help);
   if(phase==="worktree")throw Error("Use worktree command to establish isolation");
   const report=artifact(root,path);
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(root,p!).hash!==h)throw Error("Approved evidence changed; revise/restart its gate");}
   if(["build","review","browser-qa","verification","finish"].includes(phase)) {
    if(s.worktree!==root)throw Error("Delivery must run in approved worktree");
    const r=JSON.parse(report.text) as {verdict:string;commands?:{command:string;exitCode:number}[];head:string;fingerprint:string;findings?:unknown[];notApplicable?:string;tasks?:{id:string;red:string;green:string;review:string}[];scenarios?:{id:string;result:string;evidence:string}[]};
    if(r.verdict!=="PASS"||(phase!=="finish"&&r.head!==git(root,"rev-parse","HEAD"))||r.fingerprint!==fingerprint(root))throw Error("Failed or stale report");
    if(!Array.isArray(r.findings)||r.findings.length)throw Error("Resolve all findings");
    if(phase==="build"&&(!r.tasks?.length||r.tasks.some(t=>!t.id||!t.red||!t.green||!t.review)))throw Error("Per-task RED/GREEN and independent review evidence required");
    if(phase==="browser-qa"&&!(r.notApplicable?.trim())&&(!r.scenarios?.length||r.scenarios.some(t=>!t.id||t.result!=="PASS"||!t.evidence)))throw Error("Browser scenarios or explicit non-UI rationale required");
    if(phase==="verification"||phase==="build") {if(!r.commands?.length||r.commands.some(c=>!c.command||c.exitCode!==0))throw Error("Passing command evidence required");}
    if(["browser-qa","verification","finish"].includes(phase)&&s.snapshot!==fingerprint(root))throw Error("Code changed since review; retry from build");
    if(phase==="review")s.snapshot=fingerprint(root);
    if(phase==="finish"&&git(root,"status","--porcelain"))throw Error("Commit approved changes and evidence before finish");
   }
   await requireAccepted(s);
   s=complete(s,phase,path+"#sha256="+report.hash,"PASS");save(root,s);const b=await sync(s,root);
   if(s.phase==="done")await rpc(["orchestration","task-update","--id",b.rootTask,"--status","completed","--result",JSON.stringify({kind:"coordinator-container",evidence:s.evidence})]);
  } else if(command==="decide") {
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(root,p!).hash!==h&&args[0]==="approve")throw Error("Gate evidence changed; revise first");}
   if(s.phase==="uat-gate"&&args[0]==="approve"&&s.snapshot!==fingerprint(root))throw Error("UAT evidence stale; retry");
   const next=decide(s,args[0]??"",args[1]??"");
   await gateDecision(s,root,args[0]??"",args[1]??"");next.backend=s.backend;
   if(args[0]==="revise"&&(next.backend as Backend)) (next.backend as Backend).tasks={};
   s=next;save(root,s);
   if(s.phase==="cancelled")await rpc(["orchestration","task-update","--id",(s.backend as Backend).rootTask,"--status","failed","--result",JSON.stringify({reason:args[1],kind:"human-cancel"})]);
  } else if(command==="retry") {
   const b=await sync(s,root);const list=await rpc(["orchestration","task-list"]);
   for(const t of Object.values(b.tasks))if(list.result.tasks?.some((x:any)=>x.id===t.id&&["dispatched","pending","ready","blocked"].includes(x.status)))throw Error("Worker/task still live; resolve it explicitly before retry");
   s=retry(s,args.join(" "));(s.backend as Backend).tasks={};save(root,s);
  }
  else if(command==="worktree") {
   if(s.phase!=="worktree")throw Error("Plan approval required");
   const [path,branch]=args;if(!path?.startsWith("/")||!branch)throw Error(help);
   if(git(root,"status","--porcelain"))throw Error("Commit planning artifacts before creating worktree");
   git(root,"worktree","add","-b",branch,path,"HEAD");
   s=complete(s,"worktree","git worktree "+path,"PASS");s.root=git(path,"rev-parse","--show-toplevel");s.worktree=s.root;
   save(path,s);save(root,{...s,root,phase:"transferred"});console.log("Continue from "+path);
  } else throw Error(help);
 });
} catch(e) {console.error(e instanceof Error?e.message:e);process.exitCode=1;}

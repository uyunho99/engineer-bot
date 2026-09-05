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
 if(command==="doctor") await doctor();
 else if(command==="status"||command==="plan"||command==="smoke") {if(existsSync(statePath(root))) console.log(JSON.stringify(load(root),null,2));else console.log(help);}
 else await locked(root,async()=>{
  if(command==="init") {
   if(existsSync(statePath(root)))throw Error("Existing run: resume it; archive explicitly before a new run");
   const s=initial(args[0]??"");s.root=root;s.base=git(root,"rev-parse","HEAD");save(root,s);
   mkdirSync(resolve(root,"docs/development",s.id),{recursive:true});console.log(JSON.stringify(s));return;
  }
  let s=load(root);
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
   s=complete(s,phase,path+"#sha256="+report.hash,"PASS");save(root,s);
  } else if(command==="decide") {
   for(const entry of Object.values(s.evidence)){const [p,h]=entry.split("#sha256=");if(h&&artifact(root,p!).hash!==h&&args[0]==="approve")throw Error("Gate evidence changed; revise first");}
   if(s.phase==="uat-gate"&&args[0]==="approve"&&s.snapshot!==fingerprint(root))throw Error("UAT evidence stale; retry");
   s=decide(s,args[0]??"",args[1]??"");save(root,s);
  } else if(command==="retry")save(root,retry(s,args.join(" ")));
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

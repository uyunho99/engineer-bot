import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, watch as fsWatch } from "node:fs";
import { resolve } from "node:path";
import type { State } from "./harness.ts";
import { load, codeRoot, digest, statePath } from "./store.ts";
import { changedFiles } from "./repository-control.ts";
import { recordViolation, banner, type Violation } from "./guard.ts";

/** Phases in which product files may only change through a dispatched worker. */
export const WATCHED_PHASES=["build","review","browser-qa","verification","uat-gate"];
export function cliPath():string {
 for(const f of ["cli.js","cli.ts"]){const p=resolve(import.meta.dir,f);if(existsSync(p))return p;}
 throw Error("Cannot locate the harness CLI beside "+import.meta.dir);
}
export function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch{return false;}}
export const shellQuote=(x:string)=>"'"+x.replaceAll("'","'\\''")+"'";
function currentScope(stateRoot:string):{task:string;allowed_files:string[]}|null {
 const p=resolve(stateRoot,".harness/scope.json");
 return existsSync(p)?JSON.parse(readFileSync(p,"utf8")):null;
}
/**
 * One look at the code tree. changedFiles is the judge, so .gitignore and build output are
 * excluded exactly as git excludes them; each path is reported once per content.
 */
export function scanOnce(stateRoot:string,seen:Set<string>):Violation|null {
 const s=load(stateRoot), code=codeRoot(stateRoot,s), scope=currentScope(stateRoot);
 const allowed=new Set(scope?.allowed_files??[]);
 const fresh:string[]=[];
 for(const p of changedFiles(code)) {
  if(p.startsWith("docs/development/")||allowed.has(p))continue;
  const full=resolve(code,p);
  const key=p+":"+(existsSync(full)&&lstatSync(full).isFile()?digest(readFileSync(full)):"gone");
  if(seen.has(key))continue;
  seen.add(key);fresh.push(p);
 }
 return fresh.length?recordViolation(stateRoot,{paths:fresh,phase:s.phase,task:scope?.task??null}):null;
}
/** Starts one watcher per run. HARNESS_WATCH=off is for CI and test suites that start their own. */
export function startWatcher(stateRoot:string,s:State):string {
 mkdirSync(resolve(stateRoot,".harness"),{recursive:true});
 const file=resolve(stateRoot,".harness/watch.json");
 if(process.env.HARNESS_WATCH==="off"){writeFileSync(file,JSON.stringify({state:"off",reason:"HARNESS_WATCH=off"})+"\n");return "off";}
 if(existsSync(file)){try{const w=JSON.parse(readFileSync(file,"utf8"));if(w.pid&&alive(w.pid))return "running";}catch{}}
 const log=resolve(stateRoot,".harness/watch.log");
 const argv=[process.execPath,cliPath(),"watch",stateRoot].map(shellQuote).join(" ");
 const p=Bun.spawn(["sh","-c","exec "+argv+" >> "+shellQuote(log)+" 2>&1"],{cwd:codeRoot(stateRoot,s),stdin:"ignore",stdout:"ignore",stderr:"ignore"});
 p.unref();
 writeFileSync(file,JSON.stringify({pid:p.pid,startedAt:new Date().toISOString()})+"\n");
 return "started";
}
export async function watch(stateRoot:string):Promise<void> {
 const seen=new Set<string>();
 const code=codeRoot(stateRoot,load(stateRoot));
 const tick=()=>{
  try {
   if(!existsSync(statePath(stateRoot))||!WATCHED_PHASES.includes(load(stateRoot).phase))process.exit(0);
   const v=scanOnce(stateRoot,seen);
   if(v)console.error(banner([v]));
  } catch(e) {console.error("watch: "+(e instanceof Error?e.message:String(e)));if(!existsSync(code))process.exit(0);}
 };
 let pending:ReturnType<typeof setTimeout>|undefined;
 try {fsWatch(code,{recursive:true},()=>{clearTimeout(pending);pending=setTimeout(tick,300);}).on("error",()=>process.exit(0));} catch {}
 // fs events are a trigger, not the truth: some platforms drop them, so poll as well.
 setInterval(tick,2000);
 tick();
 await new Promise(()=>{});
}

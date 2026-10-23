import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "./store.ts";
import type { State } from "./harness.ts";

export type Violation={id:string;at:string;paths:string[];phase:string;task:string|null};
export function guardLogPath(stateRoot:string):string {return resolve(stateRoot,".harness/guard.log");}
export function recordViolation(stateRoot:string,v:{paths:string[];phase:string;task:string|null}):Violation {
 mkdirSync(resolve(stateRoot,".harness"),{recursive:true});
 const entry={id:crypto.randomUUID(),at:new Date().toISOString(),paths:[...new Set(v.paths)].sort(),phase:v.phase,task:v.task};
 appendFileSync(guardLogPath(stateRoot),JSON.stringify(entry)+"\n");
 return entry;
}
/** An unreadable line is itself a violation: skipping it would let a broken watcher go quiet. */
export function violations(stateRoot:string):Violation[] {
 const p=guardLogPath(stateRoot);if(!existsSync(p))return [];
 return readFileSync(p,"utf8").split("\n").filter(Boolean).map(line=>{
  try{const v=JSON.parse(line);if(typeof v.id==="string"&&Array.isArray(v.paths))return v as Violation;}catch{}
  return {id:"unreadable-"+digest(line).slice(0,16),at:"?",paths:["(unreadable guard.log entry)"],phase:"?",task:null};
 });
}
export function unacknowledged(stateRoot:string,s:State):Violation[] {
 const acked=new Set(s.history.flatMap(h=>h.acknowledged??[]));
 return violations(stateRoot).filter(v=>!acked.has(v.id));
}
export function banner(open:Violation[]):string {
 return ["⚠ "+open.length+" change(s) not explained by any worker report",
  ...open.map(v=>"    "+v.at+"  "+v.paths.join(", ")+(v.task?"  (dispatched task: "+v.task+")":"  (no task was dispatched)")),
  "  If a worker made them, or you reverted them: development-harness guard --ack '<reason>'"].join("\n");
}

import type { Agents } from "./agents.ts";
export const TRACKS = {
 full:  ["brainstorm","product-gate","design","design-gate","plan","plan-gate","worktree","build","review","browser-qa","verification","uat-gate","finish","done"],
 light: ["brainstorm","plan","plan-gate","worktree","build","review","browser-qa","verification","uat-gate","finish","done"],
} as const;
export type Track = keyof typeof TRACKS;
export const phases:readonly string[] = TRACKS.full;
export type State = { version: 1; workflowVersion?:2; track?:Track; approvedArtifacts?:Record<string,Record<string,string>>; id: string; phase: string; evidence: Record<string,string>; history: {phase:string; action:string; reference:string; at:string; task?:string; escalatedTo?:Track; waived?:string[]; actor?:"operator"|"relay"; relayQuote?:string}[]; root?:string; base?:string; worktree?:string; worktreeBranch?:string; worktreeBase?:string; snapshot?:string; configHash?:string; agents?:Agents; backend?:unknown };
export function phasesFor(s:State):readonly string[] {return TRACKS[s.track??"full"];}
export function initial(id:string,track:Track="full"):State {
 if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error("Use a lowercase feature slug (1–64 characters)");
 if (!(track in TRACKS)) throw Error("Expected track full or light");
 return {version:1,workflowVersion:2,track,id,phase:"brainstorm",evidence:{},history:[]};
}
function record(s:State,action:string,reference:string,extra:Record<string,unknown>={}):State {
 if (!reference.trim()) throw Error("Nonempty evidence/decision reference required");
 return {...structuredClone(s),history:[...s.history,{phase:s.phase,action,reference,at:new Date().toISOString(),...extra}]};
}
export function complete(s:State,phase:string,digest:string,verdict:string):State {
 const ps=phasesFor(s);
 if (phase!==s.phase || !ps.includes(phase) || phase.endsWith("-gate") || phase==="done") throw Error("Wrong phase or pending human gate");
 if(verdict!=="PASS") throw Error("Phase failed; use retry with findings, never advance on failure");
 const n=record(s,"complete",digest); n.evidence[phase]=digest;
 n.phase=ps[ps.indexOf(phase)+1]!; return n;
}
export function decide(s:State,decision:string,reference:string,opts:{escalate?:boolean;relay?:string}={}):State {
 const ps=phasesFor(s);
 if(!s.phase.endsWith("-gate")) throw Error("No pending gate");
 if(!["approve","revise","cancel"].includes(decision)) throw Error("Expected approve, revise, cancel");
 if(opts.escalate&&!(decision==="revise"&&s.phase==="plan-gate"&&(s.track??"full")==="light")) throw Error("Escalation requires revising a light-track plan gate");
 if(opts.relay!==undefined&&!opts.relay.trim()) throw Error("A relayed decision must quote the user's words");
 const who=opts.relay!==undefined?{actor:"relay",relayQuote:opts.relay}:{actor:"operator"};
 const n=record(s,decision,reference,{...who,...(opts.escalate?{escalatedTo:"full",waived:["product-gate"]}:{})});
 if(decision==="cancel") n.phase="cancelled";
 else if(decision==="approve") n.phase=ps[ps.indexOf(s.phase)+1]!;
 else if(opts.escalate) {
  n.track="full"; n.phase="design";
  for(const p of TRACKS.full.slice(TRACKS.full.indexOf("design"))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
  delete n.snapshot;
 }
 else { n.phase=s.phase==="uat-gate" ? "build" : ps[ps.indexOf(s.phase)-1]!;
  for(const p of ps.slice(ps.indexOf(n.phase))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
  delete n.snapshot;
 }
 return n;
}
export type Limits = { maxFixRounds:number; maxTotalFixRounds:number };
export const DEFAULT_LIMITS:Limits = {maxFixRounds:5,maxTotalFixRounds:15};
export function retry(s:State,findings:string,task:string,limits:Limits=DEFAULT_LIMITS):State {
 const ps=phasesFor(s);
 if(!["build","review","browser-qa","verification","uat-gate"].includes(s.phase)) throw Error("Retry only within delivery");
 if(!task.trim()) throw Error("Retry requires --task <task-id> so rounds can be counted per task");
 const all=s.history.filter(h=>h.action==="retry");
 if(all.filter(h=>h.task===task).length>=limits.maxFixRounds) throw Error(`Task ${task}: ${limits.maxFixRounds} fix rounds exhausted; obtain revised human plan`);
 if(all.length>=limits.maxTotalFixRounds) throw Error(`${limits.maxTotalFixRounds} total fix rounds exhausted; obtain revised human plan`);
 const n=record(s,"retry",findings,{task}); n.phase="build"; delete n.snapshot;
 for(const p of ps.slice(ps.indexOf("build"))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; } return n;
}

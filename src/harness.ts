export const phases = ["brainstorm","product-gate","design","design-gate","plan","plan-gate","worktree","build","review","browser-qa","verification","uat-gate","finish","done"] as const;
export type State = { version: 1; id: string; phase: string; evidence: Record<string,string>; history: {phase:string; action:string; reference:string; at:string}[]; root?:string; base?:string; worktree?:string; snapshot?:string; backend?:unknown };
export function initial(id:string):State {
 if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error("Use a lowercase feature slug (1–64 characters)");
 return {version:1,id,phase:"brainstorm",evidence:{},history:[]};
}
function record(s:State,action:string,reference:string):State {
 if (!reference.trim()) throw Error("Nonempty evidence/decision reference required");
 return {...structuredClone(s),history:[...s.history,{phase:s.phase,action,reference,at:new Date().toISOString()}]};
}
export function complete(s:State,phase:string,digest:string,verdict:string):State {
 if (phase!==s.phase || !phases.includes(phase as typeof phases[number]) || phase.endsWith("-gate") || phase==="done") throw Error("Wrong phase or pending human gate");
 if(verdict!=="PASS") throw Error("Phase failed; use retry with findings, never advance on failure");
 const n=record(s,"complete",digest); n.evidence[phase]=digest;
 n.phase=phases[phases.indexOf(phase as typeof phases[number])+1]!; return n;
}
export function decide(s:State,decision:string,reference:string):State {
 if(!s.phase.endsWith("-gate")) throw Error("No pending gate");
 if(!["approve","revise","cancel"].includes(decision)) throw Error("Expected approve, revise, cancel");
 const n=record(s,decision,reference);
 if(decision==="cancel") n.phase="cancelled";
 else if(decision==="approve") n.phase=phases[phases.indexOf(s.phase as typeof phases[number])+1]!;
 else { n.phase=s.phase==="uat-gate" ? "build" : phases[phases.indexOf(s.phase as typeof phases[number])-1]!;
  for(const p of phases.slice(phases.indexOf(n.phase as typeof phases[number]))) delete n.evidence[p];
  delete n.snapshot;
 }
 return n;
}
export function retry(s:State,findings:string):State {
 if(!["build","review","browser-qa","verification","uat-gate"].includes(s.phase)) throw Error("Retry only within delivery");
 if(s.history.filter(h=>h.action==="retry").length>=3)throw Error("Three fix rounds exhausted; obtain revised human plan");
 const n=record(s,"retry",findings); n.phase="build"; delete n.snapshot;
 for(const p of phases.slice(phases.indexOf("build"))) delete n.evidence[p]; return n;
}

import { workerInstruction } from "./repository-control.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { State } from "./harness.ts";
import { save, digest, git } from "./store.ts";
export type Backend={runtimeId:string;rootTask:string;guideHash:string;gate?:string;tasks:Record<string,{id:string;dispatchId?:string;terminal?:string;accepted?:boolean;launching?:boolean}>};
export function executable():string {
 return process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT?"orca-dev":process.platform==="linux"?"orca-ide":"orca");
}
export async function raw(args:string[]):Promise<string> {
 const p=Bun.spawn([executable(),...args],{stdout:"pipe",stderr:"pipe"});
 const [out,err]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);
 if(await p.exited!==0)throw Error(err||out);return out;
}
export async function rpc(args:string[]):Promise<any> {
 const v=JSON.parse(await raw([...args,"--json"]));
 if(v.ok!==true||!v.result)throw Error("Orca RPC failed: "+JSON.stringify(v));return v;
}
export async function contract():Promise<{hash:string;runtimeId:string}> {
 const guide=await raw(["skills","get","orchestration"]);
 const help=await raw(["orchestration","--help"]);
 for(const c of ["task-create","dispatch","dispatch-show","check","gate-create","gate-resolve","task-update"])
  if(!help.includes(c)||!guide.includes(c))throw Error("Unsupported Orca contract: "+c);
 if(help.includes("worker-start")||help.includes("run-create"))throw Error("Orca contract upgraded: review installed guide and migrate adapter before dispatch");
 const state=await rpc(["status"]);if(!state.result.runtime?.reachable||!state._meta?.runtimeId)throw Error("Orca runtime not ready");
 return {hash:digest(guide),runtimeId:state._meta.runtimeId};
}
export async function sync(s:State,root:string):Promise<Backend> {
 const c=await contract();let b=s.backend as Backend|undefined;
 if(!b){
  const v=await rpc(["orchestration","task-create","--spec",`HARNESS RUN ${s.id}: coordinator-owned container; no worker lifecycle. ${root}`]);
  if(!v.result.task?.id)throw Error("Unknown task-create schema");
  b={runtimeId:c.runtimeId,rootTask:v.result.task.id,guideHash:c.hash,tasks:{}};s.backend=b;save(root,s);
 }
 if(b.runtimeId!==c.runtimeId||b.guideHash!==c.hash)throw Error("Runtime/contract changed: reconcile state before resuming; never redispatch blindly");
 if(s.phase.endsWith("-gate")&&!b.gate){
  const v=await rpc(["orchestration","gate-create","--task",b.rootTask,"--question",`${s.id} ${s.phase}: review hashed artifacts and record approve/revise/cancel`,"--options",JSON.stringify(["approve","revise","cancel"])]);
  if(!v.result.gate?.id)throw Error("Unknown gate schema");b.gate=v.result.gate.id;save(root,s);
 }
 return b;
}
export async function gateDecision(s:State,root:string,decision:string,reference:string):Promise<void> {
 const b=await sync(s,root);if(!b.gate)throw Error("Missing runtime gate");
 const v=await rpc(["orchestration","gate-list","--task",b.rootTask]);
 const g=v.result.gates?.find((g:any)=>g.id===b.gate);
 const resolution=JSON.stringify({decision,reference});
 if(g?.status==="pending")await rpc(["orchestration","gate-resolve","--id",b.gate,"--resolution",resolution]);
 else if(g?.status!=="resolved"||g.resolution!==resolution)throw Error("Gate already resolved differently; reconcile with human before advancing");
 delete b.gate;
}
export function completion(v:any,taskId:string,dispatchId:string):boolean {
 const messages=v.result?.messages??(v.result?.message?[v.result.message]:[]);
 return messages.some((m:any)=>{let p=m.payload;try{if(typeof p==="string")p=JSON.parse(p);}catch{return false;}
  return !p?._orcaLifecycleRejection&&m.type==="worker_done"&&p?.taskId===taskId&&p?.dispatchId===dispatchId&&p?.verdict==="PASS";
 });
}
export function dispatchIdentity(d:any,taskId:string):string {
 const id=d?.id??d?.dispatchId;const task=d?.task_id??d?.taskId;
 if(typeof id!=="string"||task!==taskId)throw Error("Unknown dispatch schema or mismatched task; inspect dispatch-show");return id;
}
export async function start(s:State,root:string,specPath:string,agent:string,key=s.phase):Promise<void> {
 if(!["build","review","browser-qa","verification"].includes(s.phase)||s.worktree!==root)throw Error("Approved delivery worktree required");
 if(!["claude","codex"].includes(agent))throw Error("Worker must be claude or codex");
 if(!/^[a-zA-Z0-9-]+$/.test(key))throw Error("Invalid task key");
 const taskKey=s.phase+"/"+key;
 const b=await sync(s,root);if(b.gate)throw Error("Pending gate");
 if(b.tasks[taskKey])throw Error("Phase already has a task: check it; use retry only after confirmed failure");
 if(Object.values(b.tasks).some(t=>!t.accepted))throw Error("Check or reconcile existing task before starting another");
 const spec=readFileSync(resolve(root,specPath),"utf8");if(!spec.trim())throw Error("Empty worker spec");
 const implementing=s.phase==="build"&&!key.startsWith("review-");
 let reviewRange="";
 if(!implementing) {
  const path=resolve(root,".harness/repository-ledger.json");
  const ledger=(existsSync(path)?JSON.parse(readFileSync(path,"utf8")):[]).filter((e:any)=>e.run_id===s.id);
  const latest=ledger.at(-1);
  if(!latest)throw Error("Controller commit required before reviewer dispatch");
  reviewRange=`Review immutable range ${s.phase==="build"?ledger.find((e:any)=>e.task===latest.task).base_commit:s.base}..${latest.commit.sha}; review_commit=${latest.commit.sha}. Return review_verdict PASS/FAIL and review evidence. Do not review uncommitted changes.`;
  if(git(root,"rev-parse","HEAD")!==latest.commit.sha)throw Error("HEAD differs from latest controller task commit; reconcile review range");
 }
 const tasks=Object.values(b.tasks).filter(t=>t.accepted).map(t=>t.id);
 const v=await rpc(["orchestration","task-create","--parent",b.rootTask,"--deps",JSON.stringify(tasks),"--spec",[
 `PHASE ${s.phase}. Worktree ${root}.`,spec,
 "You are not alone. Do not revert others' work. Edit only explicitly owned paths. No nested workers or codex-plugin-cc.",
 implementing?"Use installed Superpowers TDD: failing assertion before implementation, then GREEN. Return the JSON worker contract from docs/REPOSITORY-CONTROL.md with status READY_FOR_COMMIT. Independent review follows the controller commit.":"Read-only product code authority. Write evidence reports only; return findings to coordinator.",
 implementing?workerInstruction:"Do not stage, commit, merge or mutate repository metadata. "+reviewRange,
 "For implementation, transport verdict PASS means the report status is READY_FOR_COMMIT, not reviewed or committed. Read docs/REPOSITORY-CONTROL.md. Repository control belongs to the controller.",
 "Follow live injected preamble. Report structured payload verdict PASS/FAIL, taskId, dispatchId and reportPath. Never put PASS in prose as a substitute. Send worker_done once from your own pane, then idle. Ask for blocked questions."
 ].join("\n")]);
 const id=v.result.task?.id;if(!id)throw Error("Unknown task schema");
 const task:{id:string;terminal?:string;launching?:boolean;dispatchId?:string}={id};b.tasks[taskKey]=task;save(root,s);
 const terminal=await rpc(["terminal","create","--worktree",`path:${root}`,"--title",`harness-${s.id}-${s.phase}`,"--command",agent]);
 task.terminal=terminal.result.terminal?.handle??terminal.result.handle;
 if(!task.terminal)throw Error("Unknown terminal schema: resolve via terminal list; do not create duplicate workers");save(root,s);
 await rpc(["terminal","wait","--terminal",task.terminal,"--for","tui-idle","--timeout-ms","60000"]);
 task.launching=true;save(root,s);
 await rpc(["orchestration","dispatch","--task",id,"--to",task.terminal,"--inject"]);
 const d=await rpc(["orchestration","dispatch-show","--task",id]);task.dispatchId=dispatchIdentity(d.result.dispatch,id);task.launching=false;save(root,s);
}
export async function check(s:State,root:string,key=s.phase):Promise<void> {
 const b=await sync(s,root),t=b.tasks[s.phase+"/"+key];if(!t)throw Error("No phase task");
 const current=await rpc(["orchestration","dispatch-show","--task",t.id]);
 const id=dispatchIdentity(current.result.dispatch,t.id);
 if(t.dispatchId&&t.dispatchId!==id)throw Error("Dispatch replaced; reconcile before accepting");
 t.dispatchId=id;save(root,s);
 const mail=await rpc(["orchestration","check","--wait","--types","worker_done,escalation,decision_gate","--timeout-ms","30000"]);
 // Persist mail, including other tasks' messages, so recovery never loses a consumed question.
 writeFileSync(resolve(root,".harness",`mail-${Date.now()}.json`),JSON.stringify(mail,null,2));
 console.log(JSON.stringify(mail,null,2));
 // Recover completion if a previous coordinator already read it.
 const history=completion(mail,t.id,id)?mail:await rpc(["orchestration","check","--all","--types","worker_done"]);
 const list=await rpc(["orchestration","task-list"]);
 if(completion(history,t.id,id)&&list.result.tasks?.some((x:any)=>x.id===t.id&&x.status==="completed")){
  t.accepted=true;save(root,s);console.log("Runtime completion accepted; inspect report and complete phase.");
 }else console.log("Not accepted. Timeout is not failure. Answer questions/escalations; keep live workers running.");
}
export async function requireAccepted(s:State):Promise<void> {
 if(!["build","review","browser-qa","verification"].includes(s.phase))return;
 const tasks=Object.entries((s.backend as Backend|undefined)?.tasks??{}).filter(([k])=>k.startsWith(s.phase+"/"));
 if(!tasks.length||tasks.some(([,t])=>!t.accepted))throw Error("orca-check must accept every phase task");
 const list=await rpc(["orchestration","task-list"]);
 for(const [,t] of tasks){const d=await rpc(["orchestration","dispatch-show","--task",t.id]);
  if(dispatchIdentity(d.result.dispatch,t.id)!==t.dispatchId||d.result.dispatch.status!=="completed"||!list.result.tasks?.some((x:any)=>x.id===t.id&&x.status==="completed"))throw Error("Runtime completion changed");
 }
}

import {git} from "./store.ts";
import {repositoryGate,repositoryCommit} from "./repository-control.ts";
import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {initial} from "./harness.ts";
import {sync,gateDecision,start,check,requireAccepted,contract} from "./orca.ts";
test("legacy adapter tracks task dispatch gate and rejects unsupported upgrade",async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),"orca-adapter-"))),bin=join(dir,"orca-mock"),db=join(dir,"runtime.json");
 const previous=process.env.ORCA_CLI_COMMAND;
 writeFileSync(db,JSON.stringify({tasks:[],gates:[],dispatch:null,modern:false}));
 writeFileSync(bin,`#!/usr/bin/env bun
import {readFileSync,writeFileSync} from "node:fs";
const path=${JSON.stringify(db)},s=JSON.parse(readFileSync(path,"utf8")),a=process.argv.slice(2);
const val=f=>a[a.indexOf(f)+1];let result={};
if(a[0]==="skills"){console.log("task-create dispatch dispatch-show check gate-create gate-resolve task-update");process.exit(0);}
if(a.includes("--help")){console.log("task-create dispatch dispatch-show check gate-create gate-resolve task-update"+(s.modern?" run-create worker-start":""));process.exit(0);}
if(a[0]==="status")result={runtime:{reachable:true}};
else if(a[1]==="task-create"){const task={id:"t"+s.tasks.length,status:"ready",spec:val("--spec")};s.tasks.push(task);result={task};}
else if(a[1]==="gate-create"){const gate={id:"g"+s.gates.length,status:"pending"};s.gates.push(gate);result={gate};}
else if(a[1]==="gate-list")result={gates:s.gates};
else if(a[1]==="gate-resolve"){const g=s.gates.find(g=>g.id===val("--id"));g.status="resolved";g.resolution=val("--resolution");result={gate:g};}
else if(a[0]==="terminal")result=a[1]==="create"?{terminal:{handle:"worker"}}:{ready:true};
else if(a[1]==="dispatch"){s.dispatch={id:"d",task_id:val("--task"),status:"dispatched"};s.tasks.find(t=>t.id===s.dispatch.task_id).dispatch=s.dispatch;result={dispatch:s.dispatch};}
else if(a[1]==="dispatch-show")result={dispatch:s.tasks.find(t=>t.id===val("--task")).dispatch};
else if(a[1]==="task-list")result={tasks:s.tasks};
else if(a[1]==="check"){s.dispatch.status="completed";s.tasks.find(t=>t.id===s.dispatch.task_id).status="completed";s.tasks.find(t=>t.id===s.dispatch.task_id).dispatch.status="completed";result={messages:[{type:"worker_done",payload:JSON.stringify({taskId:s.dispatch.task_id,dispatchId:"d",verdict:"PASS"})}]};}
else {console.error(a);process.exit(1);}
writeFileSync(path,JSON.stringify(s));console.log(JSON.stringify({ok:true,result,_meta:{runtimeId:"runtime"}}));
`,{mode:0o755});
 process.env.ORCA_CLI_COMMAND=bin;
 try {
  git(dir,"init");git(dir,"config","user.email","fixture@example.invalid");git(dir,"config","user.name","Controller");
  writeFileSync(join(dir,".gitignore"),".harness/\nruntime.json\norca-mock\nspec.md\n");git(dir,"add","--",".gitignore");git(dir,"commit","-m","initial");
  const s=initial("fixture");s.root=dir;s.worktree=dir;s.phase="product-gate";
  const b=await sync(s,dir);expect(b.rootTask).toBe("t0");expect(b.gate).toBe("g0");
  await gateDecision(s,dir,"approve","real user reference fixture");expect(b.gate).toBeUndefined();
  s.phase="build";writeFileSync(join(dir,"spec.md"),"Owned path test.ts. TDD.");
  await start(s,dir,"spec.md","codex","T1");
  expect(JSON.parse(readFileSync(db,"utf8")).tasks.at(-1).spec).toContain("Do not create Git commits");
  expect(JSON.parse(readFileSync(db,"utf8")).tasks.at(-1).spec).toContain("READY_FOR_COMMIT");
  await expect(requireAccepted(s)).rejects.toThrow();
  await expect(start(s,dir,"spec.md","claude","review-T1")).rejects.toThrow("existing task");
  await check(s,dir,"T1");await requireAccepted(s);
  expect(b.tasks["build/T1"]?.accepted).toBe(true);
  await expect(start(s,dir,"spec.md","claude","review-T1")).rejects.toThrow("Controller commit required");
  writeFileSync(join(dir,"app.txt"),"verified implementation\n");
  writeFileSync(join(dir,".harness/worker.json"),JSON.stringify({task:"T1",executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture red",evidence:"assertion failure"},green:{status:"passed",command:"fixture green",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:["app.txt"],proposed_commit_message:"feat: mock task",notes:[]}));
  writeFileSync(join(dir,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["app.txt"]}));
  const commit=repositoryCommit(dir,repositoryGate(dir,".harness/worker.json",".harness/scope.json").token);
  await start(s,dir,"spec.md","claude","review-T1");
  const reviewSpec=JSON.parse(readFileSync(db,"utf8")).tasks.at(-1).spec;
  expect(reviewSpec).toContain(commit.base_commit+".."+commit.commit.sha);
  expect(reviewSpec).toContain("review_commit="+commit.commit.sha);
  await check(s,dir,"review-T1");await requireAccepted(s);
  const r=JSON.parse(readFileSync(db,"utf8"));r.modern=true;writeFileSync(db,JSON.stringify(r));
  await expect(contract()).rejects.toThrow("upgraded");
 }finally{if(previous===undefined)delete process.env.ORCA_CLI_COMMAND;else process.env.ORCA_CLI_COMMAND=previous;rmSync(dir,{recursive:true,force:true});}
});

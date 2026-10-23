import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { State } from "./harness.ts";
import { load, codeRoot, artifact } from "./store.ts";
import { runAgents, ROLES, type Role } from "./agents.ts";
import { checkApprovals } from "./workflow-contract.ts";
import { prepareStatus } from "./prepare.ts";
import { workerInstruction } from "./repository-control.ts";

const PHASES:Record<Role,string[]>={implementer:["build"],reviewer:["build","review"],browserQa:["browser-qa"]};
const CONTRACT:Record<Role,string>={
 implementer:workerInstruction,
 reviewer:"Review only. Do not modify files, stage or commit. Return review_verdict PASS or FAIL with findings, and the path of the evidence you wrote.",
 browserQa:"Test only. Do not modify product source, stage or commit. Run every approved QA scenario in a real browser and report each with its URL, expected and actual result, and evidence.",
};
/** Instruction bundles ship beside the CLI: next to the bundled cli.js when installed, one level up from src/ in the repository. */
export function bundleDir():string|null {
 for(const d of [resolve(import.meta.dir,"agents"),resolve(import.meta.dir,"../agents")])if(existsSync(d))return d;
 return null;
}
function instructionsFor(engine:string,role:Role,configured?:string):string|null {
 const dir=bundleDir();
 if(configured)return isAbsolute(configured)?configured:(dir?resolve(dir,"..",configured):null);
 if(!dir)return null;
 const file=(role==="browserQa"?"browser-qa":role)+".md";
 return [resolve(dir,engine,file),resolve(dir,"common",file)].find(existsSync)??null;
}
function headingsFor(task:string):RegExp[] {
 const esc=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 const words=[task,...(/^T(\d+)$/.exec(task)?["Task "+task.slice(1)]:[])];
 return words.map(w=>new RegExp("(^|[^A-Za-z0-9-])"+esc(w)+"([^A-Za-z0-9-]|$)"));
}
/** Best effort: the approved implementation plan's section for this task, or null if it cannot be found. */
export function planExcerpt(code:string,s:State,task:string):string|null {
 const bundle=s.evidence.plan?.split("#sha256=")[0];
 if(!bundle)return null;
 try {
  const lines=artifact(code,JSON.parse(artifact(code,bundle).text).implementation).text.split("\n");
  const patterns=headingsFor(task);
  const start=lines.findIndex(l=>/^#{2,4}\s/.test(l)&&patterns.some(p=>p.test(l.replace(/^#+\s*/,""))));
  if(start<0)return null;
  const level=lines[start]!.match(/^#+/)![0].length;
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++){const m=/^(#+)\s/.exec(lines[i]!);if(m&&m[1]!.length<=level){end=i;break;}}
  return lines.slice(start,end).join("\n").trim();
 } catch {return null;}
}
function reviewTarget(stateRoot:string,s:State,task:string):string {
 if(s.phase==="review")return "Review the whole branch: git diff "+(s.worktreeBase??"<worktree base>")+"..HEAD";
 const path=resolve(stateRoot,".harness/repository-ledger.json");
 const entry=existsSync(path)?JSON.parse(readFileSync(path,"utf8")).filter((e:any)=>e.run_id===s.id&&e.task===task).at(-1):null;
 if(!entry)throw Error("No controller commit for "+task+" yet; reviewers inspect fixed commits, not the working tree");
 return "Review exactly: git diff "+entry.base_commit+".."+entry.commit.sha;
}
/**
 * Everything the controller needs to hand one task to one worker, decided by the
 * harness rather than by prose: which engine, how to reach it, where, with what scope.
 */
export function dispatchSpec(stateRoot:string,role:string,task:string,files?:string[]) {
 if(!(ROLES as readonly string[]).includes(role))throw Error("Role must be one of "+ROLES.join(", "));
 const r=role as Role, s=load(stateRoot);
 if(!PHASES[r].includes(s.phase))throw Error(r+" dispatch belongs to "+PHASES[r].join(" or ")+", not "+s.phase);
 if(!s.worktree)throw Error("Dispatch needs the approved worktree");
 if(!task.trim())throw Error("Dispatch needs a task id");
 const code=codeRoot(stateRoot,s);
 checkApprovals(code,s);
 const agent=runAgents(code,s).agents[r];
 let scope:{task:string;allowed_files:string[]}|null=null;
 if(r==="implementer") {
  const prep=prepareStatus(stateRoot);
  if(!["ok","skipped","missing"].includes(String(prep.state)))throw Error("Worktree preparation is "+String(prep.state)+"; wait for it or rerun prepare before dispatching the implementer");
  const scopePath=resolve(stateRoot,".harness/scope.json");
  if(files?.length){scope={task,allowed_files:files};writeFileSync(scopePath,JSON.stringify(scope,null,2)+"\n");}
  else if(existsSync(scopePath)&&JSON.parse(readFileSync(scopePath,"utf8")).task===task)scope=JSON.parse(readFileSync(scopePath,"utf8"));
  else throw Error("Implementer dispatch needs --files <path,...> to fix the task's scope");
 }
 const instructions=instructionsFor(agent.engine,r,agent.instructions);
 const excerpt=planExcerpt(code,s,task);
 const reportPath=".harness/"+(r==="implementer"?"worker":r)+"-"+task+".json";
 const prompt=[
  "# "+r+" — task "+task,"",
  "Working directory: "+code,
  scope?"Files you may change: "+scope.allowed_files.join(", "):"You may not change any file.",
  ...(r==="reviewer"?[reviewTarget(stateRoot,s,task)]:[]),
  "Write your report as JSON to: "+resolve(stateRoot,reportPath),"",
  CONTRACT[r],
  ...(instructions&&existsSync(instructions)?["",readFileSync(instructions,"utf8").trim()]:[]),"",
  excerpt?"## Approved plan for this task\n\n"+excerpt:"The approved plan section for "+task+" was not found; read the implementation plan in docs/development/"+s.id+"/ before starting.",
 ].join("\n");
 const dir=resolve(stateRoot,".harness/dispatch");mkdirSync(dir,{recursive:true});
 const promptFile=resolve(dir,r+"-"+task+".md");writeFileSync(promptFile,prompt+"\n");
 const fill=(x:string)=>x.replaceAll("{{promptFile}}",promptFile).replaceAll("{{prompt}}",prompt).replaceAll("{{cwd}}",code);
 const invocation=agent.dispatch.kind==="shell"?{...agent.dispatch,command:agent.dispatch.command.map(fill)}:agent.dispatch;
 return {role:r,engine:agent.engine,invocation,cwd:code,instructions,scope,planExcerpt:excerpt,promptFile,reportPath};
}

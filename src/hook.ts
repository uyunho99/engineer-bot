import { resolve, dirname, relative } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { load, within } from "./store.ts";
export function guard(input:{tool_name?:string;tool_input?:Record<string,unknown>;cwd?:string},root:string):string|undefined {
 root=realpathSync(root);
 const tool=input.tool_name??"", data=input.tool_input??{};
 if(["Write","Edit","MultiEdit","NotebookEdit"].includes(tool)) {
  const path=resolve(input.cwd??root,String(data.file_path??data.notebook_path??""));
  let ancestor=path;while(!existsSync(ancestor))ancestor=dirname(ancestor);
  const actual=resolve(realpathSync(ancestor),relative(ancestor,path));
  if(!within(root,actual)||within(resolve(root,".harness"),actual)||within(resolve(root,".claude"),actual)||actual===resolve(root,"harness.config.json"))return "Harness configuration/state is coordinator-managed; use the harness CLI.";
  let phase="";try{phase=load(root).phase;}catch{}
  if(!["build"].includes(phase)&&!within(resolve(root,"docs/development"),actual))return "Application edits require approved plan and worktree; fixes require retry to build.";
 }
 if(["Agent","Task"].includes(tool)) return "Tracked workers must use Orca dispatch; native subagents and codex-plugin-cc are forbidden.";
 if(false) {
  let phase="";try{phase=load(root).phase;}catch{}
  if(!["build","review","browser-qa","verification"].includes(phase))return "Delegate only inside an approved delivery phase.";
 }
 if(tool==="Bash") {
  const command=String(data.command??"");
  if(/(?:harness|cli\.ts)\s+decide\b/.test(command))return "Human decisions must be recorded by the operator after artifact review.";
  // Shell/plugin subprocesses retain the user's ordinary permission policy. They are
  // governed by task scope and fingerprint checks, not a misleading shell regex sandbox.
  return undefined;
 }
 return undefined;
}
if(import.meta.main) {
 try {
  const input=await Bun.stdin.json();const root=process.env.CLAUDE_PROJECT_DIR??process.cwd();const reason=guard(input,root);
  if(reason)console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:reason}}));
 }catch{console.error("Cannot validate harness guard input/state");process.exitCode=2;}
}

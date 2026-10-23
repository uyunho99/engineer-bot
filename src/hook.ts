import { resolve, dirname, relative } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { load, within } from "./store.ts";
/** Heredoc bodies are file content, not commands. Writing about a command is not running it. */
export function withoutHeredocBodies(command:string):string {
 const out:string[]=[];let end:string|null=null;
 for(const line of command.split("\n")) {
  if(end!==null){if(line.trim()===end)end=null;continue;}
  out.push(line);
  const m=/<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
  if(m)end=(m[1]??m[2]??m[3])!;
 }
 return out.join("\n");
}
export function guard(input:{tool_name?:string;tool_input?:Record<string,unknown>;cwd?:string},root:string):string|undefined {
 root=realpathSync(root);
 const tool=input.tool_name??"", data=input.tool_input??{};
 if(["Write","Edit","MultiEdit","NotebookEdit"].includes(tool)) {
  const path=resolve(input.cwd??root,String(data.file_path??data.notebook_path??""));
  let ancestor=path;while(!existsSync(ancestor))ancestor=dirname(ancestor);
  const actual=resolve(realpathSync(ancestor),relative(ancestor,path));
  let worktree:string|null=null;
  try{const w=load(root).worktree;worktree=w?realpathSync(w):null;}catch{}
  const owner=[root,...(worktree?[worktree]:[])].find(t=>within(t,actual));
  if(!owner||within(resolve(owner,".harness"),actual)||within(resolve(owner,".claude"),actual)||actual===resolve(owner,"harness.config.json"))return "Harness configuration/state is coordinator-managed; use the harness CLI.";
  if(!within(resolve(owner,"docs/development"),actual))return "Application edits belong to Codex only, after approved plan and worktree. Claude coordinates and writes planning/review reports; delegate all code and test changes through codex:codex-rescue.";
 }
 if(["Agent","Task"].includes(tool)) {
  let phase="";try{phase=load(root).phase;}catch{}
  if(!["build","review","browser-qa","verification"].includes(phase))return "Delegate only inside an approved delivery phase.";
 }
 if(tool==="Bash") {
  const command=withoutHeredocBodies(String(data.command??""));
  if(/(?:harness|cli\.(?:ts|js))["']?\s+["']?decide\b/.test(command)&&!/\s--relay\s/.test(command))return "Human decisions must be recorded by the operator after artifact review, or relayed with --relay quoting the user's own words.";
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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "./store.ts";
import { guard } from "./hook.ts";
import { HARNESS_MODES } from "./project.ts";
try {
 const input=await Bun.stdin.json();
 let root="";
 try {root=git(input.cwd??process.env.CLAUDE_PROJECT_DIR??process.cwd(),"rev-parse","--show-toplevel");}catch{}
 if(root && existsSync(resolve(root,"harness.config.json"))) {
  const config=JSON.parse(readFileSync(resolve(root,"harness.config.json"),"utf8"));
  if(HARNESS_MODES.includes(config.mode)) {
   const reason=guard(input,root);
   if(reason)console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:reason}}));
  }
 }
}catch{console.error("Cannot validate global harness hook");process.exitCode=2;}

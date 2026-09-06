import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
export async function doctor():Promise<void> {
 const home=homedir(); const registry=resolve(home,".claude/plugins/installed_plugins.json");
 const plugins=JSON.parse(readFileSync(registry,"utf8")).plugins;
 const sp=plugins["superpowers@superpowers-marketplace"]?.find((p:{scope:string})=>p.scope==="user");
 const required=["brainstorming","writing-plans","using-git-worktrees","subagent-driven-development","test-driven-development","verification-before-completion","finishing-a-development-branch"];
 for(const name of required)if(!sp||!existsSync(resolve(sp.installPath,"skills",name,"SKILL.md")))throw Error("Missing Superpowers skill: "+name);
 for(const name of ["plan-eng-review","review"])if(!existsSync(resolve(home,".claude/skills/gstack",name,"SKILL.md")))throw Error("Missing gstack skill: "+name);
 const qaPlanning=[resolve(resolve(home,".claude"),"skills/qa-planning/SKILL.md"),resolve(import.meta.dir,"../.claude/skills/qa-planning/SKILL.md")].find(existsSync);
 const browserSkill=[resolve(home,".codex/skills/harness-browser-qa/SKILL.md"),resolve(import.meta.dir,"../.agents/skills/harness-browser-qa/SKILL.md")].find(existsSync);
 if(!qaPlanning||!browserSkill)throw Error("Missing bundled qa-planning or harness-browser-qa skill; install current harness resources");
 const native=JSON.parse(readFileSync("harness.config.json","utf8")).mode==="claude-only";
 if(native&&!plugins["codex@openai-codex"]?.some((p:{installPath:string})=>existsSync(resolve(p.installPath,"agents/codex-rescue.md"))))throw Error("Missing codex-plugin-cc: see docs/OPERATIONS.md (gstack /codex is not this plugin)");
 for(const executable of ["git","bun","claude","codex"])if(!Bun.which(executable))throw Error("Missing executable: "+executable);
 console.log(JSON.stringify({superpowers:sp.version,gstack:JSON.parse(readFileSync(resolve(home,".claude/skills/gstack/package.json"),"utf8")).version,native,qaPlanning,browserSkill,design:"Resolve installed /design or /claude-design before UI design; not verified by doctor",browserQA:"Separate Codex QA worker must prove browser navigation/actions/screenshots; installation alone is not a PASS"},null,2));
}

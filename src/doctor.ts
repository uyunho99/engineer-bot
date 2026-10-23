import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadAgents, hostSkillDir, type Agents } from "./agents.ts";
import { git } from "./store.ts";
import { guardReport } from "./precommit.ts";
/** What this configuration actually depends on. Engines nobody chose are not required. */
export function requirements(a:Agents):{executables:string[];codexPlugin:boolean;codexBrowserSkill:boolean;claudeSkills:boolean;hostSkill:string} {
 const roles=Object.values(a.agents);
 const exe=new Set(["git","bun"]);
 const codexPlugin=roles.some(r=>r.dispatch.kind==="claude-agent"&&r.dispatch.agent.startsWith("codex:"));
 if(codexPlugin)exe.add("codex");
 const claudeSkills=a.controller.host==="claude-code";
 if(claudeSkills||roles.some(r=>r.dispatch.kind==="claude-agent"))exe.add("claude");
 for(const r of roles)if(r.dispatch.kind==="shell")exe.add(r.dispatch.command[0]!);
 return {executables:[...exe].sort(),codexPlugin,codexBrowserSkill:a.agents.browserQa.engine==="codex",claudeSkills,hostSkill:resolve(hostSkillDir(a.controller.host),"SKILL.md")};
}
export async function doctor():Promise<void> {
 let root=process.cwd();try{root=git(process.cwd(),"rev-parse","--show-toplevel");}catch{}
 const team=loadAgents(root), need=requirements(team);
 const home=homedir(), configDir=process.env.CLAUDE_CONFIG_DIR??resolve(home,".claude");
 if(!existsSync(need.hostSkill))throw Error("Missing the controller skill for "+team.controller.host+" at "+need.hostSkill+"; run the installer with --host "+team.controller.host);
 const report:Record<string,unknown>={hostSkill:need.hostSkill,controller:team.controller.host,engines:Object.fromEntries(Object.entries(team.agents).map(([k,v])=>[k,v.engine])),executables:need.executables};
 if(need.claudeSkills||need.codexPlugin) {
  const plugins=JSON.parse(readFileSync(resolve(configDir,"plugins/installed_plugins.json"),"utf8")).plugins;
  if(need.claudeSkills) {
   const sp=plugins["superpowers@superpowers-marketplace"]?.find((p:{scope:string})=>p.scope==="user");
   const required=["brainstorming","writing-plans","using-git-worktrees","subagent-driven-development","test-driven-development","verification-before-completion","finishing-a-development-branch"];
   for(const name of required)if(!sp||!existsSync(resolve(sp.installPath,"skills",name,"SKILL.md")))throw Error("Missing Superpowers skill: "+name);
   for(const name of ["plan-eng-review","review"])if(!existsSync(resolve(configDir,"skills/gstack",name,"SKILL.md")))throw Error("Missing gstack skill: "+name);
   const qaPlanning=[resolve(configDir,"skills/qa-planning/SKILL.md"),resolve(import.meta.dir,"../.claude/skills/qa-planning/SKILL.md")].find(existsSync);
   if(!qaPlanning)throw Error("Missing bundled qa-planning skill; install current harness resources");
   report.superpowers=sp.version;report.gstack=JSON.parse(readFileSync(resolve(configDir,"skills/gstack/package.json"),"utf8")).version;report.qaPlanning=qaPlanning;
  }
  if(need.codexPlugin&&!plugins["codex@openai-codex"]?.some((p:{installPath:string;scope:string})=>p.scope==="user"&&existsSync(resolve(p.installPath,"agents/codex-rescue.md"))))throw Error("Missing user-scope codex-plugin-cc: run claude plugin install codex@openai-codex --scope user (gstack /codex is not this plugin)");
 }
 if(need.codexBrowserSkill) {
  const browserSkill=[resolve(home,".codex/skills/harness-browser-qa/SKILL.md"),resolve(import.meta.dir,"../.agents/skills/harness-browser-qa/SKILL.md")].find(existsSync);
  if(!browserSkill)throw Error("Missing bundled harness-browser-qa skill for the codex browser QA worker; install current harness resources");
  report.browserSkill=browserSkill;
 }
 for(const executable of need.executables)if(!Bun.which(executable))throw Error("Missing executable: "+executable);
 if(existsSync(resolve(root,".harness/state.json")))try{report.guard=guardReport(root);}catch(e){report.guard="unreadable run state: "+(e as Error).message;}
 report.browserQA="The browser QA worker must prove navigation, actions and screenshots; installation alone is not a PASS";
 console.log(JSON.stringify(report,null,2));
}

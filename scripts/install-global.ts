import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync, cpSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
const root=resolve(import.meta.dir,"..");
const home=process.env.HARNESS_INSTALL_HOME??homedir();
const claude=process.env.CLAUDE_CONFIG_DIR??resolve(home,".claude"), target=resolve(claude,"skills/development-harness-native"), bin=resolve(home,".local/bin");
const settingsPath=resolve(claude,"settings.json");
const settings=existsSync(settingsPath)?JSON.parse(readFileSync(settingsPath,"utf8")):{};
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
if(existsSync(resolve(target,"SKILL.md"))&&!existsSync(resolve(target,".engineer-bot-managed")))throw Error("Existing unmanaged skill: refusing to overwrite "+target);
const qaTarget=resolve(claude,"skills/qa-planning"), browserTarget=resolve(home,".codex/skills/harness-browser-qa");
for(const dest of [qaTarget,browserTarget])if(existsSync(dest)&&!existsSync(resolve(dest,".engineer-bot-managed")))throw Error("Existing unmanaged skill: refusing to overwrite "+dest);
const launcher=resolve(bin,"development-harness");
if(existsSync(launcher)&&!readFileSync(launcher,"utf8").includes("# engineer-bot-managed"))throw Error("Existing unrelated command: "+launcher);
mkdirSync(target,{recursive:true});mkdirSync(bin,{recursive:true});
for(const [source,dest] of [[".claude/skills/qa-planning",qaTarget],[".agents/skills/harness-browser-qa",browserTarget]] as const) {
 cpSync(resolve(root,source),dest,{recursive:true});writeFileSync(resolve(dest,".engineer-bot-managed"),"1\n");
}
for(const name of ["cli","global-hook"]) {
 const result=await Bun.build({entrypoints:[resolve(root,`src/${name}.ts`)],target:"bun",outdir:target});
 if(!result.success)throw Error(String(result.logs));
}
writeFileSync(launcher,`#!/bin/sh\n# engineer-bot-managed\nexec ${quote(process.execPath)} ${quote(resolve(target,"cli.js"))} "$@"\n`);chmodSync(launcher,0o755);
let skill=readFileSync(resolve(root,".claude/skills/development-harness-native/SKILL.md"),"utf8");
skill=skill.replaceAll("`docs/WORKFLOW.md`", "`"+resolve(target,"WORKFLOW.md")+"`").replaceAll("`qa-planning`", "`"+resolve(qaTarget,"SKILL.md")+"`").replaceAll("`harness-browser-qa`", "`"+resolve(browserTarget,"SKILL.md")+"`").replaceAll("~/.local/bin/development-harness",quote(launcher)).replaceAll("bun run harness",quote(launcher)).replaceAll("bun run evidence",quote(launcher)+" evidence").replaceAll("`docs/REPOSITORY-CONTROL.md`", "`"+resolve(target,"REPOSITORY-CONTROL.md")+"`").replaceAll("`docs/OPERATIONS.md`", "`"+resolve(target,"OPERATIONS.md")+"`");
writeFileSync(resolve(target,"SKILL.md"),skill);writeFileSync(resolve(target,"OPERATIONS.md"),readFileSync(resolve(root,"docs/OPERATIONS.md"),"utf8").replaceAll("../README.md","README.md"));writeFileSync(resolve(target,"README.md"),readFileSync(resolve(root,"README.md"),"utf8").replaceAll("docs/WORKFLOW.md","WORKFLOW.md").replaceAll("docs/REPOSITORY-CONTROL.md","REPOSITORY-CONTROL.md").replaceAll("docs/OPERATIONS.md","OPERATIONS.md").replaceAll(".claude/skills/development-harness-native/SKILL.md","SKILL.md"));writeFileSync(resolve(target,".engineer-bot-managed"),"1\n");
copyFileSync(resolve(root,"docs/REPOSITORY-CONTROL.md"),resolve(target,"REPOSITORY-CONTROL.md"));
copyFileSync(resolve(root,"docs/WORKFLOW.md"),resolve(target,"WORKFLOW.md"));
const hookCommand=`${quote(process.execPath)} ${quote(resolve(target,"global-hook.js"))}`;
settings.extraKnownMarketplaces??={};
settings.extraKnownMarketplaces["openai-codex"]??={source:{source:"github",repo:"openai/codex-plugin-cc"}};
settings.enabledPlugins??={};
settings.enabledPlugins["codex@openai-codex"]??=true;
settings.hooks??={};settings.hooks.PreToolUse??=[];
if(!settings.hooks.PreToolUse.some((entry:any)=>entry.hooks?.some((h:any)=>h.command===hookCommand)))settings.hooks.PreToolUse.push({matcher:"Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task",hooks:[{type:"command",command:hookCommand}]});
if(existsSync(settingsPath))copyFileSync(settingsPath,settingsPath+".harness-backup-"+Date.now());
writeFileSync(settingsPath,JSON.stringify(settings,null,2)+"\n");
console.log("Installed: "+launcher+"\nRestart Claude Code in your project, then invoke /development-harness-native.\nExisting settings preserved; hook activates only for mode=claude-only projects. Dependencies/plugins remain separate.");

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync, cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { HOSTS, hostSkillDir } from "../src/agents.ts";
const root=resolve(import.meta.dir,"..");
const version:string=JSON.parse(readFileSync(resolve(root,"package.json"),"utf8")).version;
const args=process.argv.slice(2), force=args.includes("--force");
const asked=args.flatMap((a,i)=>args[i-1]==="--host"?a.split(","):[]).map(h=>h.trim()).filter(Boolean);
if(args.includes("--host")&&!asked.length)throw Error("--host needs one of: "+HOSTS.join(", "));
for(const h of asked)if(!(HOSTS as readonly string[]).includes(h))throw Error("Unknown host "+JSON.stringify(h)+"; supported: "+HOSTS.join(", ")+". Antigravity is not supported yet: where it reads skills and how it runs headless are unconfirmed.");
const hosts=asked.length?[...new Set(asked)]:["claude-code"];
const parts=(v:string)=>v.trim().split(".").map(n=>parseInt(n,10)||0);
const newer=(a:string,b:string)=>{const x=parts(a),y=parts(b);for(let i=0;i<3;i++)if((x[i]??0)!==(y[i]??0))return (x[i]??0)>(y[i]??0);return false;};
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";

const home=process.env.HARNESS_INSTALL_HOME??homedir();
const claude=process.env.CLAUDE_CONFIG_DIR??resolve(home,".claude");
// One CLI per machine, outside every host's directory: the controller may be any of them.
const data=resolve(home,".local/share/development-harness");
const launcher=resolve(home,".local/bin/development-harness");
const skillDirs:Record<string,{skill:string;qa:string}>={
 "claude-code":{skill:hostSkillDir("claude-code",home,claude),qa:resolve(claude,"skills/qa-planning")},
 codex:{skill:hostSkillDir("codex",home,claude),qa:resolve(home,".codex/skills/qa-planning")},
 gemini:{skill:hostSkillDir("gemini",home,claude),qa:resolve(home,".gemini/skills/qa-planning")},
};
// The codex browser QA worker's skill; its defaults are used under Claude Code and codex controllers.
const browserTarget=resolve(home,".codex/skills/harness-browser-qa");
const withBrowser=hosts.some(h=>h==="claude-code"||h==="codex");

const managed=(dir:string)=>existsSync(resolve(dir,".engineer-bot-managed"));
const claimed=[data,...hosts.flatMap(h=>[skillDirs[h]!.skill,skillDirs[h]!.qa]),...(withBrowser?[browserTarget]:[])];
for(const dir of claimed)if(existsSync(dir)&&!managed(dir)&&(existsSync(resolve(dir,"SKILL.md"))||existsSync(resolve(dir,"cli.js"))))throw Error("Existing unmanaged files: refusing to overwrite "+dir);
if(existsSync(launcher)&&!readFileSync(launcher,"utf8").includes("# engineer-bot-managed"))throw Error("Existing unrelated command: "+launcher);
// Installing from an older checkout used to replace a newer harness without a word.
const versionPath=resolve(data,"VERSION");
if(existsSync(versionPath)) {
 const installed=readFileSync(versionPath,"utf8").trim();
 if(newer(installed,version)&&!force)throw Error("Refusing to downgrade the installed harness from "+installed+" to "+version+"; rerun with --force if that is intended");
}

mkdirSync(data,{recursive:true});
for(const name of ["cli","global-hook"]) {
 const result=await Bun.build({entrypoints:[resolve(root,`src/${name}.ts`)],target:"bun",outdir:data});
 if(!result.success)throw Error(String(result.logs));
}
rmSync(resolve(data,"agents"),{recursive:true,force:true});cpSync(resolve(root,"agents"),resolve(data,"agents"),{recursive:true});
for(const doc of ["WORKFLOW.md","REPOSITORY-CONTROL.md","OPERATIONS.md"])copyFileSync(resolve(root,"docs",doc),resolve(data,doc));
writeFileSync(resolve(data,"README.md"),readFileSync(resolve(root,"README.md"),"utf8").replaceAll("docs/WORKFLOW.md","WORKFLOW.md").replaceAll("docs/REPOSITORY-CONTROL.md","REPOSITORY-CONTROL.md").replaceAll("docs/OPERATIONS.md","OPERATIONS.md"));
writeFileSync(resolve(data,".engineer-bot-managed"),"1\n");
mkdirSync(resolve(home,".local/bin"),{recursive:true});
writeFileSync(launcher,`#!/bin/sh\n# engineer-bot-managed\nexec ${quote(process.execPath)} ${quote(resolve(data,"cli.js"))} "$@"\n`);chmodSync(launcher,0o755);

const source=readFileSync(resolve(root,".claude/skills/development-harness-native/SKILL.md"),"utf8");
if(withBrowser){cpSync(resolve(root,".agents/skills/harness-browser-qa"),browserTarget,{recursive:true});writeFileSync(resolve(browserTarget,".engineer-bot-managed"),"1\n");}
for(const host of hosts) {
 const {skill,qa}=skillDirs[host]!;
 mkdirSync(skill,{recursive:true});
 cpSync(resolve(root,".claude/skills/qa-planning"),qa,{recursive:true});writeFileSync(resolve(qa,".engineer-bot-managed"),"1\n");
 writeFileSync(resolve(skill,"SKILL.md"),source
  .replaceAll("`docs/WORKFLOW.md`","`"+resolve(data,"WORKFLOW.md")+"`")
  .replaceAll("`docs/REPOSITORY-CONTROL.md`","`"+resolve(data,"REPOSITORY-CONTROL.md")+"`")
  .replaceAll("`docs/OPERATIONS.md`","`"+resolve(data,"OPERATIONS.md")+"`")
  .replaceAll("`qa-planning`","`"+resolve(qa,"SKILL.md")+"`")
  .replaceAll("`harness-browser-qa`","`"+resolve(browserTarget,"SKILL.md")+"`")
  .replaceAll("~/.local/bin/development-harness",quote(launcher))
  .replaceAll("bun run harness",quote(launcher)));
 writeFileSync(resolve(skill,".engineer-bot-managed"),"1\n");
}

if(hosts.includes("claude-code")) {
 const skill=skillDirs["claude-code"]!.skill;
 // Earlier versions kept the CLI and documents inside the Claude skill. One copy now lives in data.
 for(const stale of ["cli.js","global-hook.js","WORKFLOW.md","REPOSITORY-CONTROL.md","OPERATIONS.md","README.md","VERSION"])rmSync(resolve(skill,stale),{force:true});
 const settingsPath=resolve(claude,"settings.json");
 const settings=existsSync(settingsPath)?JSON.parse(readFileSync(settingsPath,"utf8")):{};
 const hookCommand=`${quote(process.execPath)} ${quote(resolve(data,"global-hook.js"))}`;
 const oldHook=resolve(skill,"global-hook.js");
 settings.extraKnownMarketplaces??={};
 settings.extraKnownMarketplaces["openai-codex"]??={source:{source:"github",repo:"openai/codex-plugin-cc"}};
 settings.enabledPlugins??={};
 settings.enabledPlugins["codex@openai-codex"]??=true;
 settings.hooks??={};settings.hooks.PreToolUse??=[];
 settings.hooks.PreToolUse=settings.hooks.PreToolUse
  .map((entry:any)=>({...entry,hooks:(entry.hooks??[]).filter((h:any)=>!String(h.command??"").includes(oldHook))}))
  .filter((entry:any)=>entry.hooks.length);
 if(!settings.hooks.PreToolUse.some((entry:any)=>entry.hooks?.some((h:any)=>h.command===hookCommand)))settings.hooks.PreToolUse.push({matcher:"Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task",hooks:[{type:"command",command:hookCommand}]});
 if(existsSync(settingsPath))copyFileSync(settingsPath,settingsPath+".harness-backup-"+Date.now());
 mkdirSync(claude,{recursive:true});
 writeFileSync(settingsPath,JSON.stringify(settings,null,2)+"\n");
}
writeFileSync(versionPath,version+"\n");
console.log("Installed harness "+version+" for "+hosts.join(", ")+"\nCLI: "+launcher+" -> "+resolve(data,"cli.js")+"\n"+hosts.map(h=>"  "+h+": "+skillDirs[h]!.skill).join("\n")+
 (hosts.includes("claude-code")?"\nRestart Claude Code in your project, then invoke /development-harness-native. The hook acts only in projects whose harness.config.json mode is harness (or the legacy claude-only).":"")+
 "\nSet controller.host in ~/.config/development-harness/agents.json or the project's harness.config.json when the controller is not Claude Code.");

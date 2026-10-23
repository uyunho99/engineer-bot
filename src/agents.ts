import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const ROLES=["implementer","reviewer","browserQa"] as const;
export type Role=typeof ROLES[number];
export type Dispatch=
 | {kind:"claude-agent";agent:string;args?:string[];readOnly?:boolean}
 | {kind:"shell";command:string[];readOnly?:boolean};
export type Agent={engine:string;dispatch:Dispatch;instructions?:string};
export type Agents={controller:{host:string};agents:Record<Role,Agent>;requireCrossEngineReview:boolean};

/** Today's behaviour: every worker is a fresh codex-plugin-cc session. Unconfigured users see no change. */
export const DEFAULT_AGENTS:Record<Role,Agent>={
 implementer:{engine:"codex",dispatch:{kind:"claude-agent",agent:"codex:codex-rescue",args:["--wait","--fresh","--write"]}},
 reviewer:{engine:"codex",dispatch:{kind:"claude-agent",agent:"codex:codex-rescue",args:["--wait","--fresh"],readOnly:true}},
 browserQa:{engine:"codex",dispatch:{kind:"claude-agent",agent:"codex:codex-rescue",args:["--wait","--fresh"]}},
};

/** Hosts that can run the controller. Antigravity is not here yet: its skills location and headless mode are unconfirmed. */
export const HOSTS=["claude-code","codex","gemini"] as const;
export type Host=typeof HOSTS[number];
const shell=(engine:string,command:string[],readOnly=false):Agent=>({engine,dispatch:{kind:"shell",command,...(readOnly?{readOnly:true}:{})}});
const codexExec=(sandbox:string)=>["codex","exec","-s",sandbox,"-C","{{cwd}}","{{prompt}}"];
// Gemini CLI's non-interactive flags; not verified on the machine this was built on.
const geminiRun=["gemini","-y","-p","{{prompt}}"];
/** Where each host reads the controller skill. The installer writes here and doctor checks here. */
export function hostSkillDir(host:string,home:string=homedir(),claudeDir:string=process.env.CLAUDE_CONFIG_DIR??resolve(home,".claude")):string {
 return host==="claude-code"?resolve(claudeDir,"skills/development-harness-native"):resolve(home,"."+host,"skills/development-harness");
}
/** Only Claude Code has the Agent tool, so other controllers start their workers as processes. */
export const HOST_DEFAULTS:Record<Host,Record<Role,Agent>>={
 "claude-code":DEFAULT_AGENTS,
 codex:{implementer:shell("codex",codexExec("workspace-write")),reviewer:shell("codex",codexExec("read-only"),true),browserQa:shell("codex",codexExec("workspace-write"))},
 gemini:{implementer:shell("gemini",geminiRun),reviewer:shell("gemini",geminiRun,true),browserQa:shell("gemini",geminiRun)},
};

/**
 * The person layer lives outside every host's own config directory, because the
 * controller itself may be Claude Code, Codex or Gemini.
 */
export function personConfigPath():string {
 const home=process.env.HARNESS_CONFIG_HOME??resolve(process.env.XDG_CONFIG_HOME??resolve(homedir(),".config"),"development-harness");
 return resolve(home,"agents.json");
}
function read(path:string):any {
 if(!existsSync(path))return {};
 try{return JSON.parse(readFileSync(path,"utf8"));}catch(e){throw Error("Unreadable agent configuration "+path+": "+(e as Error).message);}
}
const name=/^[a-z][a-z0-9-]*$/;
function checkAgent(role:string,a:any,source:string):Agent {
 const bad=(why:string)=>Error(source+": agents."+role+" "+why);
 if(!a||typeof a!=="object")throw bad("must be an object");
 if(typeof a.engine!=="string"||!name.test(a.engine))throw bad("needs a lowercase engine name");
 const d=a.dispatch;
 if(d?.kind==="claude-agent") {
  if(typeof d.agent!=="string"||!d.agent.trim())throw bad("dispatch needs an agent name");
  if(d.args!==undefined&&(!Array.isArray(d.args)||d.args.some((x:unknown)=>typeof x!=="string")))throw bad("dispatch args must be strings");
 } else if(d?.kind==="shell") {
  if(!Array.isArray(d.command)||!d.command.length||d.command.some((x:unknown)=>typeof x!=="string"||!x))throw bad("shell dispatch needs a non-empty command array");
  if(!d.command.some((x:string)=>x.includes("{{prompt}}")||x.includes("{{promptFile}}")))throw bad("shell dispatch must pass {{prompt}} or {{promptFile}}");
 } else throw bad("dispatch.kind must be claude-agent or shell");
 if(a.instructions!==undefined&&typeof a.instructions!=="string")throw bad("instructions must be a path");
 return a as Agent;
}
/** Each role comes whole from one layer: the project's if it names the role, else the person's, else the default. */
export function loadAgents(projectRoot:string):Agents {
 const personPath=personConfigPath(), projectPath=resolve(projectRoot,"harness.config.json");
 const person=read(personPath), project=read(projectPath);
 const host=project.controller?.host??person.controller?.host??"claude-code";
 if(!(HOSTS as readonly string[]).includes(host))throw Error("controller.host must be one of "+HOSTS.join(", ")+" (got "+JSON.stringify(host)+")");
 const defaults=HOST_DEFAULTS[host as Host];
 const agents={} as Record<Role,Agent>;
 for(const role of ROLES) {
  if(project.agents?.[role]!==undefined)agents[role]=checkAgent(role,project.agents[role],projectPath);
  else if(person.agents?.[role]!==undefined)agents[role]=checkAgent(role,person.agents[role],personPath);
  else agents[role]=defaults[role];
 }
 const cross=project.requireCrossEngineReview??person.requireCrossEngineReview??false;
 if(typeof cross!=="boolean")throw Error("requireCrossEngineReview must be true or false");
 if(cross&&agents.reviewer.engine===agents.implementer.engine)throw Error("requireCrossEngineReview is on but reviewer and implementer both use "+agents.implementer.engine);
 const claudeOnly=ROLES.filter(r=>agents[r].dispatch.kind==="claude-agent");
 if(host!=="claude-code"&&claudeOnly.length)throw Error("claude-agent dispatch ("+claudeOnly.join(", ")+") needs Claude Code as the controller, but controller.host is "+host+"; use a shell dispatch");
 return {controller:{host},agents,requireCrossEngineReview:cross};
}
/** A run uses the engines pinned when its plan was completed, so resuming on another machine changes nothing. */
export function runAgents(codeRoot:string,s:{agents?:Agents}):Agents {
 return s.agents??loadAgents(codeRoot);
}

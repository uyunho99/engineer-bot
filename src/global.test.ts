import { test, expect, setDefaultTimeout } from "bun:test";
// These tests drive real git repositories and spawn the CLI dozens of times; the 5s
// default is too tight once the machine is busy, and a timeout here says nothing about
// the harness. Unit tests elsewhere keep the default.
setDefaultTimeout(30_000);
// Never read the developer's own agent configuration.
process.env.HARNESS_CONFIG_HOME=mkdtempSync(join(tmpdir(),"harness-person-empty-"));
process.env.HARNESS_WATCH="off";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "./store.ts";
test("global install preserves settings, repeats safely, isolates projects, and executes target verification",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness global '")), home=join(base,"home"), root=join(base,"project"), other=join(base,"other");
 try {
  mkdirSync(join(home,".claude"),{recursive:true});
  writeFileSync(join(home,".claude/settings.json"),JSON.stringify({model:"preserve-me",hooks:{PreToolUse:[{matcher:"Read",hooks:[{type:"command",command:"true"}]}]}}));
  const install=()=>Bun.spawnSync([process.execPath,join(import.meta.dir,"../scripts/install-global.ts")],{env:{...process.env,HARNESS_INSTALL_HOME:home,CLAUDE_CONFIG_DIR:join(home,".claude")}});
  expect(install().exitCode).toBe(0);expect(install().exitCode).toBe(0);
  expect(readFileSync(join(home,".local/share/development-harness/REPOSITORY-CONTROL.md"),"utf8")).toContain("Workers produce verified changes");
  expect(existsSync(join(home,".claude/skills/qa-planning/assets/QA_PLAN.template.md"))).toBe(true);
  expect(existsSync(join(home,".codex/skills/harness-browser-qa/SKILL.md"))).toBe(true);
  expect(existsSync(join(home,".local/share/development-harness/WORKFLOW.md"))).toBe(true);
  const settings=JSON.parse(readFileSync(join(home,".claude/settings.json"),"utf8"));
  expect(settings.model).toBe("preserve-me");expect(settings.hooks.PreToolUse.length).toBe(2);
  for(const dir of [root,other]){mkdirSync(dir);git(dir,"init");git(dir,"config","user.email","test@example.invalid");git(dir,"config","user.name","Test");writeFileSync(join(dir,"app.txt"),"original");git(dir,"add",".");git(dir,"commit","-m","initial");}
  const cli=(dir:string,...args:string[])=>Bun.spawnSync([join(home,".local/bin/development-harness"),...args],{cwd:dir});
  const hook=(dir:string)=>Bun.spawnSync([process.execPath,join(home,".local/share/development-harness/global-hook.js")],{cwd:dir,stdin:new TextEncoder().encode(JSON.stringify({cwd:dir,tool_name:"Write",tool_input:{file_path:join(dir,"app.txt")}}))});
  expect(hook(other).stdout.toString()).toBe("");
  expect(cli(root,"setup").exitCode).toBe(0);expect(cli(root,"setup").exitCode).toBe(0);
  expect(readFileSync(join(root,"app.txt"),"utf8")).toBe("original");
  expect(existsSync(join(root,"package.json"))).toBe(false);
  expect(hook(root).stdout.toString()).toContain('"deny"');
  expect(cli(root,"configure",JSON.stringify([[process.execPath,"-e","if (!require('fs').existsSync('app.txt')) process.exit(1)"]])).exitCode).toBe(0);
  expect(cli(root,"init","demo").exitCode).toBe(0);
  expect(existsSync(join(other,".harness/state.json"))).toBe(false);
  expect(cli(root,"evidence").exitCode).toBe(0);
  const report=JSON.parse(readFileSync(join(root,"docs/development/demo/verification.json"),"utf8"));expect(report.verdict).toBe("PASS");
  expect(cli(root,"configure",JSON.stringify([[process.execPath,"-e","process.exit(3)"]])).exitCode).toBe(0);
  expect(cli(root,"evidence").exitCode).toBe(1);
  expect(JSON.parse(readFileSync(join(root,"docs/development/demo/verification.json"),"utf8")).verdict).toBe("FAIL");
 }finally {rmSync(base,{recursive:true,force:true});}
});
test("the installer refuses to downgrade an installed harness unless forced, and the hook honours both mode spellings",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-version-")), home=join(base,"home"), dir=join(base,"project");
 try{
  mkdirSync(join(home,".claude"),{recursive:true});
  const install=(...extra:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"../scripts/install-global.ts"),...extra],{env:{...process.env,HARNESS_INSTALL_HOME:home,CLAUDE_CONFIG_DIR:join(home,".claude")}});
  expect(install().exitCode).toBe(0);
  const versionFile=join(home,".local/share/development-harness/VERSION");
  const shipped=JSON.parse(readFileSync(join(import.meta.dir,"../package.json"),"utf8")).version;
  expect(readFileSync(versionFile,"utf8").trim()).toBe(shipped);
  expect(install().exitCode).toBe(0);
  writeFileSync(versionFile,"99.0.0\n");
  const refused=install();
  expect(refused.exitCode).not.toBe(0);expect(refused.stderr.toString()).toContain("downgrade");
  expect(readFileSync(versionFile,"utf8").trim()).toBe("99.0.0");
  expect(install("--force").exitCode).toBe(0);
  expect(readFileSync(versionFile,"utf8").trim()).toBe(shipped);
  mkdirSync(dir);git(dir,"init");writeFileSync(join(dir,"app.txt"),"x");
  const hook=()=>Bun.spawnSync([process.execPath,join(home,".local/share/development-harness/global-hook.js")],{cwd:dir,stdin:new TextEncoder().encode(JSON.stringify({cwd:dir,tool_name:"Write",tool_input:{file_path:join(dir,"app.txt")}}))}).stdout.toString();
  for(const mode of ["harness","claude-only"]){writeFileSync(join(dir,"harness.config.json"),JSON.stringify({version:1,mode}));expect(hook()).toContain('"deny"');}
  writeFileSync(join(dir,"harness.config.json"),JSON.stringify({version:1,mode:"orca"}));expect(hook()).toBe("");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("each host gets its own bundle over one shared CLI, and a codex-only install leaves ~/.claude alone",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-hosts-")), home=join(base,"home"), data=join(home,".local/share/development-harness");
 const install=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"../scripts/install-global.ts"),...a],{env:{...process.env,HARNESS_INSTALL_HOME:home,CLAUDE_CONFIG_DIR:join(home,".claude")}});
 try{
  const codex=install("--host","codex");expect(codex.stderr.toString()).toBe("");expect(codex.exitCode).toBe(0);
  expect(existsSync(join(home,".claude"))).toBe(false);
  expect(existsSync(join(home,".codex/skills/development-harness/SKILL.md"))).toBe(true);
  expect(existsSync(join(data,"cli.js"))).toBe(true);expect(existsSync(join(data,"agents/common/implementer.md"))).toBe(true);
  expect(readFileSync(join(home,".local/bin/development-harness"),"utf8")).toContain(join(data,"cli.js"));
  expect(readFileSync(join(home,".codex/skills/development-harness/SKILL.md"),"utf8")).toContain(join(data,"WORKFLOW.md"));
  expect(install("--host","claude-code").exitCode).toBe(0);
  expect(existsSync(join(home,".claude/skills/development-harness-native/SKILL.md"))).toBe(true);
  expect(existsSync(join(home,".claude/skills/development-harness-native/cli.js"))).toBe(false);
  expect(existsSync(join(home,".codex/skills/development-harness/SKILL.md"))).toBe(true);
  expect(JSON.stringify(JSON.parse(readFileSync(join(home,".claude/settings.json"),"utf8")).hooks.PreToolUse)).toContain(join(data,"global-hook.js"));
  expect(install("--host","gemini").exitCode).toBe(0);
  expect(existsSync(join(home,".gemini/skills/development-harness/SKILL.md"))).toBe(true);
  const agy=install("--host","antigravity");expect(agy.exitCode).not.toBe(0);expect(agy.stderr.toString()).toContain("Antigravity");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("installing over the old layout moves the hook and removes the stale copies",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-migrate-")), home=join(base,"home"), skill=join(home,".claude/skills/development-harness-native");
 const install=()=>Bun.spawnSync([process.execPath,join(import.meta.dir,"../scripts/install-global.ts")],{env:{...process.env,HARNESS_INSTALL_HOME:home,CLAUDE_CONFIG_DIR:join(home,".claude")}});
 try{
  mkdirSync(skill,{recursive:true});
  for(const f of [".engineer-bot-managed","SKILL.md","cli.js","global-hook.js","WORKFLOW.md"])writeFileSync(join(skill,f),"old\n");
  const old="'/usr/local/bin/bun' '"+join(skill,"global-hook.js")+"'";
  writeFileSync(join(home,".claude/settings.json"),JSON.stringify({hooks:{PreToolUse:[{matcher:"Read",hooks:[{type:"command",command:"true"}]},{matcher:"Write|Edit",hooks:[{type:"command",command:old}]}]}}));
  expect(install().exitCode).toBe(0);
  const hooks=JSON.stringify(JSON.parse(readFileSync(join(home,".claude/settings.json"),"utf8")).hooks.PreToolUse);
  expect(hooks).not.toContain(join(skill,"global-hook.js"));
  expect(hooks).toContain(join(home,".local/share/development-harness/global-hook.js"));
  expect(hooks).toContain('"command":"true"');
  for(const f of ["cli.js","global-hook.js","WORKFLOW.md"])expect(existsSync(join(skill,f))).toBe(false);
  expect(readFileSync(join(skill,"SKILL.md"),"utf8")).not.toBe("old\n");
 }finally{rmSync(base,{recursive:true,force:true});}
});

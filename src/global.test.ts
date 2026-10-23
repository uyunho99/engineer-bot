import { test, expect, setDefaultTimeout } from "bun:test";
// These tests drive real git repositories and spawn the CLI dozens of times; the 5s
// default is too tight once the machine is busy, and a timeout here says nothing about
// the harness. Unit tests elsewhere keep the default.
setDefaultTimeout(30_000);
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
  expect(readFileSync(join(home,".claude/skills/development-harness-native/REPOSITORY-CONTROL.md"),"utf8")).toContain("Workers produce verified changes");
  expect(existsSync(join(home,".claude/skills/qa-planning/assets/QA_PLAN.template.md"))).toBe(true);
  expect(existsSync(join(home,".codex/skills/harness-browser-qa/SKILL.md"))).toBe(true);
  expect(existsSync(join(home,".claude/skills/development-harness-native/WORKFLOW.md"))).toBe(true);
  const settings=JSON.parse(readFileSync(join(home,".claude/settings.json"),"utf8"));
  expect(settings.model).toBe("preserve-me");expect(settings.hooks.PreToolUse.length).toBe(2);
  for(const dir of [root,other]){mkdirSync(dir);git(dir,"init");git(dir,"config","user.email","test@example.invalid");git(dir,"config","user.name","Test");writeFileSync(join(dir,"app.txt"),"original");git(dir,"add",".");git(dir,"commit","-m","initial");}
  const cli=(dir:string,...args:string[])=>Bun.spawnSync([join(home,".local/bin/development-harness"),...args],{cwd:dir});
  const hook=(dir:string)=>Bun.spawnSync([process.execPath,join(home,".claude/skills/development-harness-native/global-hook.js")],{cwd:dir,stdin:new TextEncoder().encode(JSON.stringify({cwd:dir,tool_name:"Write",tool_input:{file_path:join(dir,"app.txt")}}))});
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

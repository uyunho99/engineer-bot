import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { State } from "./harness.ts";
import { git, load, codeRoot, statePath } from "./store.ts";
import { recordViolation, banner } from "./guard.ts";
import { WATCHED_PHASES, cliPath, alive, shellQuote } from "./watch.ts";

const MARK="engineer-bot-managed pre-commit";
/**
 * The hooks directory is shared by every worktree of a repository, so the hook names no run.
 * It follows a pointer in the committing worktree's own git directory and does nothing where
 * there is none, which includes the main checkout. Removing the worktree removes the pointer.
 */
export function installPrecommit(stateRoot:string,s:State):string {
 const code=codeRoot(stateRoot,s);
 let hooksPath="";try{hooksPath=git(code,"config","core.hooksPath");}catch{}
 if(hooksPath)return "skipped: the repository sets core.hooksPath ("+hooksPath+"); add the harness pre-commit there by hand if wanted";
 const hooks=resolve(code,git(code,"rev-parse","--git-path","hooks")), hook=resolve(hooks,"pre-commit");
 if(existsSync(hook)&&!readFileSync(hook,"utf8").includes(MARK))return "skipped: an existing pre-commit hook is not the harness's and was left untouched";
 writeFileSync(resolve(code,git(code,"rev-parse","--git-dir"),"harness-state"),realpathSync(stateRoot)+"\n");
 mkdirSync(hooks,{recursive:true});
 writeFileSync(hook,["#!/bin/sh","# "+MARK+" (harness guard, layer 4)",
  'pointer="$(git rev-parse --git-dir)/harness-state"','[ -f "$pointer" ] || exit 0',
  "exec "+shellQuote(process.execPath)+" "+shellQuote(cliPath())+' precommit-check "$(cat "$pointer")"',""].join("\n"));
 chmodSync(hook,0o755);
 return "installed";
}
export function precommitCheck(stateRoot:string):number {
 if(!stateRoot||!existsSync(statePath(stateRoot)))return 0;
 const s=load(stateRoot);
 if(!WATCHED_PHASES.includes(s.phase))return 0;
 const code=codeRoot(stateRoot,s), scopePath=resolve(stateRoot,".harness/scope.json");
 const scope=existsSync(scopePath)?JSON.parse(readFileSync(scopePath,"utf8")):null;
 const allowed=new Set<string>(scope?.allowed_files??[]);
 const outside=git(code,"diff","--cached","--name-only","--no-renames","-z").split("\0").filter(p=>p&&!p.startsWith("docs/development/")&&!allowed.has(p));
 if(!outside.length)return 0;
 const v=recordViolation(stateRoot,{paths:outside,phase:s.phase,task:scope?.task??null});
 console.error(banner([v])+"\nCommit refused: these files are outside the dispatched task's scope. Hand the change to the implementer and commit through the repository gate.");
 return 1;
}
export function guardReport(stateRoot:string):{precommit:string;watcher:string} {
 const s=load(stateRoot), file=resolve(stateRoot,".harness/watch.json");
 let watcher="not started";
 if(existsSync(file)) {
  try {const w=JSON.parse(readFileSync(file,"utf8"));watcher=w.state==="off"?"off ("+w.reason+")":w.pid&&alive(w.pid)?"running (pid "+w.pid+")":"stopped (pid "+w.pid+" is not running)";}
  catch {watcher="unreadable watch.json";}
 }
 return {precommit:s.precommit??"not installed",watcher};
}

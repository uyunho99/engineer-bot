import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export function prepareCommand(worktree:string):string[]|null {
 if(existsSync(resolve(worktree,"bun.lock"))||existsSync(resolve(worktree,"bun.lockb")))return ["bun","install","--frozen-lockfile"];
 if(existsSync(resolve(worktree,"pnpm-lock.yaml")))return ["pnpm","install","--frozen-lockfile"];
 if(existsSync(resolve(worktree,"yarn.lock")))return ["yarn","install","--immutable"];
 if(existsSync(resolve(worktree,"package-lock.json")))return ["npm","ci"];
 if(existsSync(resolve(worktree,"package.json")))return ["npm","install"];
 return null;
}
function statusPath(stateRoot:string):string {return resolve(stateRoot,".harness/worktree-prepare.json");}
export function prepareStatus(stateRoot:string):{state:string;[k:string]:unknown} {
 const p=statusPath(stateRoot);
 if(!existsSync(p))return {state:"missing"};
 try{return JSON.parse(readFileSync(p,"utf8"));}catch{return {state:"failed",reason:"unreadable prepare status"};}
}
/**
 * The install outlives this process, so the shell it runs in writes the status
 * itself. An exited handler here would die with the CLI and never fire.
 */
export function startPrepare(stateRoot:string,worktree:string):void {
 mkdirSync(resolve(stateRoot,".harness"),{recursive:true});
 const argv=prepareCommand(worktree);
 if(!argv){writeFileSync(statusPath(stateRoot),JSON.stringify({state:"skipped",reason:"no recognised manifest or lockfile"})+"\n");return;}
 const q=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 const log=resolve(stateRoot,".harness/worktree-prepare.log");
 writeFileSync(statusPath(stateRoot),JSON.stringify({state:"running",command:argv.join(" "),startedAt:new Date().toISOString()})+"\n");
 const script=`${argv.map(q).join(" ")} > ${q(log)} 2>&1; code=$?; if [ $code -eq 0 ]; then state=ok; else state=failed; fi; printf '{"state":"%s","command":%s,"exitCode":%d,"log":%s}\\n' "$state" ${q(JSON.stringify(argv.join(" ")))} "$code" ${q(JSON.stringify(log))} > ${q(statusPath(stateRoot))}`;
 Bun.spawn(["sh","-c",script],{cwd:worktree,stdin:"ignore",stdout:"ignore",stderr:"ignore"}).unref();
}

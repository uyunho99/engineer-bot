import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { State } from "./harness.ts";
export function git(cwd:string,...args:string[]):string {
 const r=Bun.spawnSync(["git","-C",cwd,...args],{stdout:"pipe",stderr:"pipe"});
 if(r.exitCode!==0) throw Error(r.stderr.toString()); return r.stdout.toString().trim();
}
export function repo():string { return realpathSync(git(process.cwd(),"rev-parse","--show-toplevel")); }
export function digest(text:string|Buffer):string {return createHash("sha256").update(text).digest("hex");}
export function within(root:string,path:string):boolean {const p=relative(root,path);return p!==".."&&!p.startsWith("../")&&!isAbsolute(p);}
export function artifact(root:string,path:string):{hash:string;text:string} {
 root=realpathSync(root); const full=realpathSync(resolve(root,path));
 if(!within(resolve(root,"docs/development"),full)) throw Error("Evidence must be under docs/development (no escaping symlinks)");
 const bytes=readFileSync(full), text=bytes.toString("utf8"); if(!text.trim()) throw Error("Empty evidence");
 return {hash:digest(bytes),text};
}
export function fingerprint(root:string):string {
 const paths=git(root,"ls-files","-z","--cached","--others","--exclude-standard").split("\0").filter(p=>p&&!p.startsWith("docs/development/")&&!p.startsWith(".harness/"));
 return digest(paths.sort().map(p=>p+":"+(existsSync(resolve(root,p))?(lstatSync(resolve(root,p)).isSymbolicLink()?digest(readlinkSync(resolve(root,p))):lstatSync(resolve(root,p)).isDirectory()?git(resolve(root,p),"rev-parse","HEAD"):digest(readFileSync(resolve(root,p)))):"deleted")).join("\n"));
}
export function statePath(root:string):string{return resolve(root,".harness/state.json");}
export function load(root:string):State {root=realpathSync(root);const s=JSON.parse(readFileSync(statePath(root),"utf8"));if(s.version!==1||s.root!==root)throw Error("Wrong state version/worktree");return s;}
export function save(root:string,s:State):void {const p=statePath(root);mkdirSync(resolve(root,".harness"),{recursive:true});writeFileSync(p+".tmp",JSON.stringify({...s,root:realpathSync(root)},null,2)+"\n",{mode:0o600});renameSync(p+".tmp",p);}
export async function locked(root:string,fn:()=>Promise<void>|void):Promise<void> {
 mkdirSync(resolve(root,".harness"),{recursive:true});const lock=resolve(root,".harness/lock");
 try{mkdirSync(lock);}catch{throw Error("Another coordinator holds .harness/lock; inspect liveness before manual recovery");}
 try{await fn();}finally{rmSync(lock,{recursive:true});}
}

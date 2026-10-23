import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verificationCommands } from "./project.ts";
import { repo, load, git, fingerprint, codeRoot } from "./store.ts";
export function evidence(stateRoot:string):void {
const s=load(stateRoot);
const root=codeRoot(stateRoot,s);
const before=fingerprint(root), head=git(root,"rev-parse","HEAD");
const commands={stdout:"pipe",stderr:"pipe"} as const;
const results=[];
for(const argv of verificationCommands(root)) {
 const r=Bun.spawnSync(argv,{...commands,cwd:root});
 results.push({command:argv.join(" "),exitCode:r.exitCode,stdout:r.stdout.toString(),stderr:r.stderr.toString()});
}
if(before!==fingerprint(root)||head!==git(root,"rev-parse","HEAD"))throw Error("Verification changed source or HEAD; review changes and rerun");
const dir=resolve(root,"docs/development",s.id);mkdirSync(dir,{recursive:true});
const path=resolve(dir,"verification.json");
writeFileSync(path,JSON.stringify({verdict:results.every(r=>r.exitCode===0)?"PASS":"FAIL",head:git(root,"rev-parse","HEAD"),fingerprint:fingerprint(root),commands:results,findings:[]},null,2));
console.log(path);if(results.some(r=>r.exitCode!==0))process.exitCode=1;

}
if(import.meta.main)evidence(repo());

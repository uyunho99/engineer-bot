import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { repo, load, git, fingerprint } from "./store.ts";
const root=repo(), s=load(root);
const commands={stdout:"pipe",stderr:"pipe"} as const;
const results=[];
for(const argv of [["bun","run","check"],["bun","run","build"]]) {
 const r=Bun.spawnSync(argv,commands);
 results.push({command:argv.join(" "),exitCode:r.exitCode,stdout:r.stdout.toString(),stderr:r.stderr.toString()});
}
const dir=resolve(root,"docs/development",s.id);mkdirSync(dir,{recursive:true});
const path=resolve(dir,"verification.json");
writeFileSync(path,JSON.stringify({verdict:results.every(r=>r.exitCode===0)?"PASS":"FAIL",head:git(root,"rev-parse","HEAD"),fingerprint:fingerprint(root),commands:results,findings:[]},null,2));
console.log(path);if(results.some(r=>r.exitCode!==0))process.exitCode=1;

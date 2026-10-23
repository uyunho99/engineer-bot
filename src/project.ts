import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "./store.ts";
import type { Limits } from "./harness.ts";
export function setup(root:string):void {
 const path=resolve(root,"harness.config.json");
 if(existsSync(path)) {
  const config=JSON.parse(readFileSync(path,"utf8"));
  if(config.mode!=="claude-only")throw Error("Existing harness configuration belongs to another mode; not overwritten");
 } else writeFileSync(path,JSON.stringify({version:1,mode:"claude-only",verificationCommands:[]},null,2)+"\n");
 const ignore=resolve(root,".gitignore");const old=existsSync(ignore)?readFileSync(ignore,"utf8"):"";
 if(!old.split(/\r?\n/).includes(".harness/"))writeFileSync(ignore,old+(old&&!old.endsWith("\n")?"\n":"")+".harness/\n");
 console.log("Project connected. Set verificationCommands in harness.config.json to real command argument arrays before plan approval. Commit project setup and planning artifacts before worktree creation.");
 try {git(root,"rev-parse","HEAD");}catch{console.log("New repository: create an initial commit before harness init.");}
}
export function verificationCommands(root:string):string[][] {
 const config=JSON.parse(readFileSync(resolve(root,"harness.config.json"),"utf8"));
 const commands=config.verificationCommands;
 if(!Array.isArray(commands)||!commands.length||commands.some((c:unknown)=>!Array.isArray(c)||!c.length||c.some(x=>typeof x!=="string"||!x.trim())))throw Error("Set non-empty verificationCommands in harness.config.json, e.g. [[\"npm\",\"test\"],[\"npm\",\"run\",\"build\"]]");
 return commands;
}
export function allowRelay(root:string):boolean {
 const path=resolve(root,"harness.config.json");
 if(!existsSync(path))return true;
 const v=JSON.parse(readFileSync(path,"utf8")).approval?.allowRelay;
 if(v!==undefined&&typeof v!=="boolean")throw Error("approval.allowRelay must be true or false");
 return v!==false;
}
export function fixLimits(root:string):Limits {
 const config=JSON.parse(readFileSync(resolve(root,"harness.config.json"),"utf8"));
 const read=(v:unknown,fallback:number,name:string):number=>{
  if(v===undefined)return fallback;
  if(!Number.isInteger(v)||(v as number)<1)throw Error(name+" must be a positive integer");
  return v as number;
 };
 return {maxFixRounds:read(config.maxFixRounds,5,"maxFixRounds"),maxTotalFixRounds:read(config.maxTotalFixRounds,15,"maxTotalFixRounds")};
}

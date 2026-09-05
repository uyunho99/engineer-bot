import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "./store.ts";
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

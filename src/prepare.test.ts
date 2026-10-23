import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepareCommand,startPrepare,prepareStatus} from "./prepare.ts";
test("package manager is chosen from the lockfile",()=>{
 const wt=mkdtempSync(join(tmpdir(),"harness-prep-"));
 try{
  expect(prepareCommand(wt)).toBeNull();
  writeFileSync(join(wt,"package.json"),"{}");
  expect(prepareCommand(wt)).toEqual(["npm","install"]);
  writeFileSync(join(wt,"package-lock.json"),"{}");
  expect(prepareCommand(wt)).toEqual(["npm","ci"]);
  writeFileSync(join(wt,"bun.lock"),"");
  expect(prepareCommand(wt)).toEqual(["bun","install","--frozen-lockfile"]);
 }finally{rmSync(wt,{recursive:true,force:true});}
});
test("a project without a manifest is skipped, not blocked",()=>{
 const root=mkdtempSync(join(tmpdir(),"harness-prepstate-")),wt=mkdtempSync(join(tmpdir(),"harness-prepwt-"));
 try{
  mkdirSync(join(root,".harness"),{recursive:true});
  expect(prepareStatus(root).state).toBe("missing");
  startPrepare(root,wt);
  expect(prepareStatus(root).state).toBe("skipped");
 }finally{rmSync(root,{recursive:true,force:true});rmSync(wt,{recursive:true,force:true});}
});

import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setup} from "./project.ts";
test("setup writes the harness mode and keeps accepting the legacy spelling",()=>{
 const fresh=mkdtempSync(join(tmpdir(),"harness-setup-")),legacy=mkdtempSync(join(tmpdir(),"harness-setup-legacy-")),other=mkdtempSync(join(tmpdir(),"harness-setup-other-"));
 try{
  setup(fresh);
  expect(JSON.parse(readFileSync(join(fresh,"harness.config.json"),"utf8")).mode).toBe("harness");
  writeFileSync(join(legacy,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[]}));
  setup(legacy);
  expect(JSON.parse(readFileSync(join(legacy,"harness.config.json"),"utf8")).mode).toBe("claude-only");
  writeFileSync(join(other,"harness.config.json"),JSON.stringify({version:1,mode:"orca"}));
  expect(()=>setup(other)).toThrow("another mode");
 }finally{for(const d of [fresh,legacy,other])rmSync(d,{recursive:true,force:true});}
});

import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {initial} from "./harness.ts";
import {save,load,locked,artifact,fingerprint,git} from "./store.ts";
import {guard} from "./hook.ts";
test("state is scoped, locks exclude concurrent coordinators, and source changes fingerprint",async()=>{
 const root=mkdtempSync(join(tmpdir(),"harness-store-"));
 try{
  git(root,"init");writeFileSync(join(root,".gitignore"),".harness/\n");
  const s=initial("sample");s.root=root;save(root,s);expect(load(root).phase).toBe("brainstorm");
  await locked(root,async()=>{await expect(locked(root,()=>{})).rejects.toThrow("Another coordinator");});
  const first=fingerprint(root);writeFileSync(join(root,"source.ts"),"new code");expect(fingerprint(root)).not.toBe(first);
  mkdirSync(join(root,"docs/development"),{recursive:true});const before=fingerprint(root);
  writeFileSync(join(root,"docs/development/report.md"),"evidence");expect(fingerprint(root)).toBe(before);
  expect(artifact(root,"docs/development/report.md").text).toBe("evidence");
  expect(()=>artifact(root,"source.ts")).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("hook rejects source writes before approval and symlink parent escapes",()=>{
 const root=mkdtempSync(join(tmpdir(),"harness-hook-")),outside=mkdtempSync(join(tmpdir(),"harness-outside-"));
 try{
  expect(guard({tool_name:"Write",tool_input:{file_path:join(root,"code.ts")}},root)).toContain("approved plan");
  const state=initial("sample");state.phase="build";save(root,state);
  expect(guard({tool_name:"Edit",tool_input:{file_path:join(root,"code.ts")}},root)).toContain("Codex only");
  mkdirSync(join(root,"docs/development"),{recursive:true});
  expect(guard({tool_name:"Write",tool_input:{file_path:join(root,"docs/development/plan.md")}},root)).toBeUndefined();
  symlinkSync(outside,join(root,"docs/development/escape"));
  expect(guard({tool_name:"Write",tool_input:{file_path:join(root,"docs/development/escape/file.md")}},root)).toBeDefined();
  expect(guard({tool_name:"Bash",tool_input:{command:"bun run harness decide approve forged"}},root)).toBeDefined();
  for(const command of ["'/tmp/my tools/development-harness' decide approve forged", 'bun "/tmp/cli.js" decide approve forged'])expect(guard({tool_name:"Bash",tool_input:{command}},root)).toBeDefined();
  expect(guard({tool_name:"Bash",tool_input:{command:"bun run harness status"}},root)).toBeUndefined();
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadAgents,DEFAULT_AGENTS} from "./agents.ts";
import {validateBuildTasks,validateIndependent} from "./workflow-contract.ts";
import {requirements} from "./doctor.ts";

const withConfig=(person:object|null,project:object|null,fn:(root:string)=>void)=>{
 const home=mkdtempSync(join(tmpdir(),"harness-agents-home-")),root=mkdtempSync(join(tmpdir(),"harness-agents-proj-"));
 const prev=process.env.HARNESS_CONFIG_HOME;process.env.HARNESS_CONFIG_HOME=home;
 try{
  if(person)writeFileSync(join(home,"agents.json"),JSON.stringify(person));
  if(project)writeFileSync(join(root,"harness.config.json"),JSON.stringify(project));
  fn(root);
 }finally{
  if(prev===undefined)delete process.env.HARNESS_CONFIG_HOME;else process.env.HARNESS_CONFIG_HOME=prev;
  rmSync(home,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});
 }
};
const gemini={engine:"gemini",dispatch:{kind:"shell",command:["gemini","-y","-p","{{prompt}}"]}};
const claudeReviewer={engine:"claude",dispatch:{kind:"claude-agent",agent:"general-purpose",readOnly:true}};

test("without configuration every role keeps today's codex worker",()=>withConfig(null,null,root=>{
 const a=loadAgents(root);
 expect(a.agents).toEqual(DEFAULT_AGENTS);
 expect(a.controller.host).toBe("claude-code");
 expect(a.requireCrossEngineReview).toBe(false);
}));
test("a project role overrides the person's role and other roles fall through",()=>withConfig(
 {agents:{implementer:gemini,reviewer:claudeReviewer}},
 {agents:{implementer:{engine:"codex",dispatch:{kind:"claude-agent",agent:"codex:codex-rescue"}}}},
 root=>{
  const a=loadAgents(root).agents;
  expect(a.implementer.engine).toBe("codex");
  expect(a.reviewer.engine).toBe("claude");
  expect(a.browserQa).toEqual(DEFAULT_AGENTS.browserQa);
 }));
test("malformed roles are rejected and name their source",()=>{
 withConfig({agents:{implementer:{engine:"Gemini!",dispatch:gemini.dispatch}}},null,root=>expect(()=>loadAgents(root)).toThrow("engine"));
 withConfig(null,{agents:{implementer:{engine:"gemini",dispatch:{kind:"shell",command:["gemini","-y"]}}}},root=>expect(()=>loadAgents(root)).toThrow("{{prompt}}"));
 withConfig(null,{agents:{reviewer:{engine:"x",dispatch:{kind:"carrier-pigeon"}}}},root=>expect(()=>loadAgents(root)).toThrow("harness.config.json"));
});
test("cross-engine review can be required and is enforced when loading",()=>{
 withConfig(null,{requireCrossEngineReview:true},root=>expect(()=>loadAgents(root)).toThrow("both use codex"));
 withConfig(null,{requireCrossEngineReview:true,agents:{reviewer:claudeReviewer}},root=>expect(loadAgents(root).requireCrossEngineReview).toBe(true));
});
test("build and review evidence must name the configured engines",()=>withConfig(null,{agents:{implementer:gemini,reviewer:claudeReviewer}},root=>{
 const team=loadAgents(root).agents;
 const task={id:"T1",red:"r",green:"g",review:"v",dispatch:"run-1"};
 validateBuildTasks({tasks:[{...task,executor:"gemini"}]},team);
 expect(()=>validateBuildTasks({tasks:[{...task,executor:"codex"}]},team)).toThrow("gemini");
 validateIndependent({executor:"claude",role:"code-review",dispatch:"rev-1",freshSession:true},"code-review",["run-1"],team.reviewer.engine);
 expect(()=>validateIndependent({executor:"gemini",role:"code-review",dispatch:"rev-1",freshSession:true},"code-review",["run-1"],team.reviewer.engine)).toThrow("claude");
}));

test("a codex controller gets codex exec workers and needs nothing from Claude Code",()=>withConfig({controller:{host:"codex"}},null,root=>{
 const a=loadAgents(root);
 expect(a.controller.host).toBe("codex");
 for(const role of ["implementer","reviewer","browserQa"] as const)expect(a.agents[role].dispatch.kind).toBe("shell");
 expect(a.agents.reviewer.dispatch).toMatchObject({command:["codex","exec","-s","read-only","-C","{{cwd}}","{{prompt}}"]});
 const need=requirements(a);
 expect(need.claudeSkills).toBe(false);expect(need.codexPlugin).toBe(false);
 expect(need.executables).toEqual(["bun","codex","git"]);
 expect(need.hostSkill).toMatch(/\.codex\/skills\/development-harness\/SKILL\.md$/);
}));
test("a gemini controller defaults to gemini workers",()=>withConfig({controller:{host:"gemini"}},null,root=>{
 const a=loadAgents(root);
 expect(a.agents.implementer.engine).toBe("gemini");
 expect(requirements(a).executables).toEqual(["bun","gemini","git"]);
}));
test("Claude Code agents cannot be dispatched by another controller, and unknown hosts are refused",()=>{
 withConfig({controller:{host:"gemini"},agents:{reviewer:{engine:"claude",dispatch:{kind:"claude-agent",agent:"general-purpose"}}}},null,root=>expect(()=>loadAgents(root)).toThrow("Claude Code"));
 withConfig({controller:{host:"antigravity"}},null,root=>expect(()=>loadAgents(root)).toThrow("controller.host"));
});

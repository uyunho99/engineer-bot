import { test, expect } from "bun:test";
import { initial, complete, decide, retry } from "./harness.ts";
test("mandatory gates cannot be skipped or completed as work", () => {
 let s = initial("test");
 expect(() => decide(s, "approve", "user")).toThrow();
 s = complete(s, "brainstorm", "digest", "PASS");
 expect(s.phase).toBe("product-gate");
 expect(() => complete(s, "product-gate", "digest", "PASS")).toThrow();
 expect(() => complete(s, "design", "digest", "PASS")).toThrow();
 expect(decide(s, "approve", "user message 1").phase).toBe("design");
 expect(decide(s, "revise", "user message 2").phase).toBe("brainstorm");
 expect(decide(s, "cancel", "user message 3").phase).toBe("cancelled");
});
test("full flow requires review QA verification and explicit UAT", () => {
 let s = initial("test");
 for (const p of ["brainstorm", "design", "plan"]) {
  s=complete(s,p,"digest","PASS"); s=decide(s,"approve","human");
 }
 for (const p of ["worktree","build","review","browser-qa","verification"]) s=complete(s,p,"digest","PASS");
 expect(s.phase).toBe("uat-gate");
 expect(() => complete(s,"finish","digest","PASS")).toThrow();
 s=decide(s,"approve","human");
 expect(complete(s,"finish","digest","PASS").phase).toBe("done");
});
test("failed QA returns to build and invalidates later evidence", () => {
 let s=initial("test"); s.phase="browser-qa";
 expect(() => complete(s,"browser-qa","digest","FAIL")).toThrow();
 s.evidence.review="old"; s.evidence.verification="stale";
 s=retry(s,"regression","T1");
 expect(s.phase).toBe("build"); expect(s.evidence.review).toBeUndefined();
 expect(s.evidence.verification).toBeUndefined();
});
test("empty approval and evidence cannot advance", () => {
 expect(() => complete(initial("test"),"brainstorm","","PASS")).toThrow();
 const s=complete(initial("test"),"brainstorm","digest","PASS");
 expect(() => decide(s,"approve","")).toThrow();
});

test("fix rounds are counted per task against the configured limit",()=>{
 let s=initial("test");s.phase="build";
 for(let i=0;i<5;i++)s=retry(s,"finding","T1");
 expect(()=>retry(s,"again","T1")).toThrow("Task T1");
 s=retry(s,"other task","T2");
 expect(s.history.filter(h=>h.action==="retry"&&h.task==="T2").length).toBe(1);
});
test("retry requires a task and honours an overall ceiling",()=>{
 let s=initial("test");s.phase="build";
 expect(()=>retry(s,"finding","")).toThrow("--task");
 const limits={maxFixRounds:99,maxTotalFixRounds:2};
 s=retry(s,"a","T1",limits);s=retry(s,"b","T2",limits);
 expect(()=>retry(s,"c","T3",limits)).toThrow("2 total fix rounds");
});
test("a lower configured limit stops the retry earlier",()=>{
 let s=initial("test");s.phase="build";
 const limits={maxFixRounds:2,maxTotalFixRounds:15};
 s=retry(s,"finding","T1",limits);s=retry(s,"finding","T1",limits);
 expect(()=>retry(s,"again","T1",limits)).toThrow("Task T1");
});

test("light track skips product and design gates",()=>{
 let s=initial("test","light");
 expect(s.track).toBe("light");
 s=complete(s,"brainstorm","digest","PASS");
 expect(s.phase).toBe("plan");
 expect(()=>complete(s,"design","digest","PASS")).toThrow();
 s=complete(s,"plan","digest","PASS");
 expect(s.phase).toBe("plan-gate");
 expect(decide(s,"revise","human").phase).toBe("plan");
 expect(decide(s,"approve","human").phase).toBe("worktree");
});
test("full track is the default and keeps its gates",()=>{
 const s=initial("test");
 expect(s.track).toBe("full");
 expect(complete(s,"brainstorm","digest","PASS").phase).toBe("product-gate");
 const legacy={...initial("test")} as any;delete legacy.track;
 expect(complete(legacy,"brainstorm","digest","PASS").phase).toBe("product-gate");
});
test("escalation moves a light plan gate to the full design phase",()=>{
 let s=initial("test","light");
 s=complete(s,"brainstorm","digest","PASS");
 s=complete(s,"plan","plan-digest","PASS");
 expect(s.phase).toBe("plan-gate");
 const e=decide(s,"revise","mockup needed",{escalate:true});
 expect(e.track).toBe("full");
 expect(e.phase).toBe("design");
 expect(e.evidence.plan).toBeUndefined();
 expect(e.evidence.brainstorm).toBe("digest");
 const last=e.history.at(-1)!;
 expect(last.escalatedTo).toBe("full");
 expect(last.waived).toEqual(["product-gate"]);
});
test("escalation is rejected outside a light plan gate",()=>{
 let s=initial("test","light");
 s=complete(s,"brainstorm","digest","PASS");
 s=complete(s,"plan","digest","PASS");
 expect(()=>decide(s,"approve","human",{escalate:true})).toThrow("Escalation");
 let f=initial("test");
 f=complete(f,"brainstorm","digest","PASS");
 expect(()=>decide(f,"revise","human",{escalate:true})).toThrow("Escalation");
});
test("relayed decisions are attributed and need the user's words",()=>{
 let s=initial("test");s=complete(s,"brainstorm","digest","PASS");
 expect(()=>decide(s,"approve","ref",{relay:"  "})).toThrow("user's words");
 const r=decide(s,"approve","conversation 12",{relay:"좋아 진행해"});
 expect(r.history.at(-1)!.actor).toBe("relay");
 expect(r.history.at(-1)!.relayQuote).toBe("좋아 진행해");
 expect(decide(s,"approve","terminal").history.at(-1)!.actor).toBe("operator");
});

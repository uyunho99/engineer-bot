# 하네스 v2 — 1단계(척추) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하네스에 경량/전체 트랙을 도입하고, 상태는 메인 체크아웃에 코드는 worktree에 두어 컨트롤러 세션이 이동하지 않게 하며, 수정 재시도를 태스크 단위 설정값으로 바꾼다.

**Architecture:** `src/harness.ts`의 단일 `phases` 배열을 트랙별 `TRACKS` 로 바꾸고 모든 전이 함수가 `phasesFor(s)` 를 보게 한다. `src/store.ts` 에 `codeRoot(stateRoot, s)` 를 추가해 "상태가 있는 곳"과 "코드가 있는 곳"을 분리하고, `cli.ts`·`evidence.ts`·`repository-control.ts` 의 배송 단계 연산이 code root 를 대상으로 돌게 한다. 컨트롤러가 메인에 남으면서 사라지는 암묵적 보장을 `repositoryCommit` 의 명시적 단언으로 대체한다.

**Tech Stack:** TypeScript (bun 런타임), `bun:test`, Git CLI. 외부 의존성 없음.

## Global Constraints

- 런타임은 Bun 이다. `node:fs`·`node:path`·`node:os` 와 `Bun.spawn`/`Bun.spawnSync` 외의 의존성을 추가하지 않는다.
- 기존 코드 스타일을 따른다: 들여쓰기 1칸, 세미콜론, 한 줄에 조건+throw, `export function` 선호.
- 모든 테스트는 `src/*.test.ts` 에 두고 `bun test src` 로 돈다. 검증 명령은 `bun run check` (`tsc --noEmit && bun test src`) 다.
- `state.version` 은 `1` 을 유지한다. 새 필드는 전부 선택적(optional)이어야 하며, 기존 상태 파일이 그대로 로드되어야 한다.
- `track` 이 없는 상태는 `full` 로 동작한다 (설계 §9).
- 기존 테스트를 삭제하거나 약화시키지 않는다. 특히 `src/store.test.ts:31-33` 의 승인 차단 3종은 계속 통과해야 한다.
- `mode:"claude-only"` 는 계속 유효하다. 1단계에서 `mode` 값을 바꾸지 않는다.
- 커밋은 태스크마다 한 번. 메시지는 기존 컨벤션(`feat(harness): ...`, `fix(harness): ...`)을 따른다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/harness.ts` | 상태 타입과 순수 전이 함수. I/O 없음 | 수정 — 트랙, 승격, 태스크 단위 재시도 |
| `src/store.ts` | 경로·해시·git·상태 입출력 | 수정 — `codeRoot` 추가 |
| `src/project.ts` | `harness.config.json` 읽기 | 수정 — `fixLimits` 추가 |
| `src/prepare.ts` | worktree 의존성 설치 백그라운드 실행 | **신규** |
| `src/cli.ts` | 명령 디스패치와 단계별 전제 검사 | 수정 — 두 root 라우팅, `worktree` 명령, `retry --task` |
| `src/evidence.ts` | 검증 명령 실행과 `verification.json` 기록 | 수정 — code root 대상 |
| `src/repository-control.ts` | 게이트·커밋·원장 | 수정 — 두 root 분리, worktree 단언 |
| `src/hook.ts` | PreToolUse 가드 | 수정 — worktree 경로 허용 |
| `harness.config.json` | 프로젝트 설정 | 수정 — `maxFixRounds` 5, `maxTotalFixRounds` 15 |

`src/prepare.ts` 를 따로 두는 이유: 백그라운드 프로세스 수명 관리는 상태 전이나 게이트와 책임이 다르고, 패키지 매니저 탐지는 이 파일에서만 바뀐다.

**테스트 배치** — 순수 전이는 `src/harness.test.ts`, 경로·가드는 `src/store.test.ts`, 두 root 라우팅과 커밋 경계는 `src/cli.test.ts`, 준비 과정은 신규 `src/prepare.test.ts`.

---

## Task 1: 트랙별 phase 목록

**Files:**
- Modify: `src/harness.ts:1-31`
- Test: `src/harness.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `export const TRACKS: { full: readonly string[]; light: readonly string[] }`
  - `export type Track = "full" | "light"`
  - `export const phases: readonly string[]` (= `TRACKS.full`, 기존 import 호환용)
  - `export function phasesFor(s: State): readonly string[]`
  - `export function initial(id: string, track?: Track): State`
  - `State` 에 `track?: Track` 추가
  - `record(s, action, reference, extra?)` 가 `extra` 를 히스토리 항목에 병합 (Task 2·3 이 사용)

- [ ] **Step 1: Write the failing test**

`src/harness.test.ts` 끝에 추가한다.

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/harness.test.ts -t "light track"`
Expected: FAIL — `initial("test","light")` 이 두 번째 인자를 무시하므로 `s.track` 이 `undefined` 다.

- [ ] **Step 3: Write minimal implementation**

`src/harness.ts` 의 1~11행을 대체한다.

```ts
export const TRACKS = {
 full:  ["brainstorm","product-gate","design","design-gate","plan","plan-gate","worktree","build","review","browser-qa","verification","uat-gate","finish","done"],
 light: ["brainstorm","plan","plan-gate","worktree","build","review","browser-qa","verification","uat-gate","finish","done"],
} as const;
export type Track = keyof typeof TRACKS;
export const phases = TRACKS.full;
export type State = { version: 1; workflowVersion?:2; track?:Track; approvedArtifacts?:Record<string,Record<string,string>>; id: string; phase: string; evidence: Record<string,string>; history: {phase:string; action:string; reference:string; at:string; task?:string; escalatedTo?:Track; waived?:string[]; actor?:"operator"|"relay"; relayQuote?:string}[]; root?:string; base?:string; worktree?:string; worktreeBranch?:string; snapshot?:string; configHash?:string; backend?:unknown };
export function phasesFor(s:State):readonly string[] {return TRACKS[s.track??"full"];}
export function initial(id:string,track:Track="full"):State {
 if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error("Use a lowercase feature slug (1–64 characters)");
 if (!(track in TRACKS)) throw Error("Expected track full or light");
 return {version:1,workflowVersion:2,track,id,phase:"brainstorm",evidence:{},history:[]};
}
function record(s:State,action:string,reference:string,extra:Record<string,unknown>={}):State {
 if (!reference.trim()) throw Error("Nonempty evidence/decision reference required");
 return {...structuredClone(s),history:[...s.history,{phase:s.phase,action,reference,at:new Date().toISOString(),...extra}]};
}
```

`complete` 와 `decide` 에서 전역 `phases` 참조를 `phasesFor(s)` 로 바꾼다.

```ts
export function complete(s:State,phase:string,digest:string,verdict:string):State {
 const ps=phasesFor(s);
 if (phase!==s.phase || !ps.includes(phase) || phase.endsWith("-gate") || phase==="done") throw Error("Wrong phase or pending human gate");
 if(verdict!=="PASS") throw Error("Phase failed; use retry with findings, never advance on failure");
 const n=record(s,"complete",digest); n.evidence[phase]=digest;
 n.phase=ps[ps.indexOf(phase)+1]!; return n;
}
```

`decide` 의 세 군데 `phases` 를 `ps` 로 바꾼다 (함수 첫 줄에 `const ps=phasesFor(s);`).

```ts
 else if(decision==="approve") n.phase=ps[ps.indexOf(s.phase)+1]!;
 else { n.phase=s.phase==="uat-gate" ? "build" : ps[ps.indexOf(s.phase)-1]!;
  for(const p of ps.slice(ps.indexOf(n.phase))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
  delete n.snapshot;
 }
```

`retry` 의 `phases.slice(phases.indexOf("build"))` 도 `ps.slice(ps.indexOf("build"))` 로 바꾼다 (`const ps=phasesFor(s);` 추가).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS — 신규 2개 포함 전부 통과. 기존 `mandatory gates cannot be skipped`·`full flow requires ...` 도 통과해야 한다 (기본값이 `full` 이므로).

- [ ] **Step 5: Commit**

```bash
git add src/harness.ts src/harness.test.ts
git commit -m "feat(harness): split the phase list into full and light tracks"
```

---

## Task 2: plan-gate 승격

**Files:**
- Modify: `src/harness.ts` (`decide`)
- Test: `src/harness.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `TRACKS`, `phasesFor`, `record(s,action,reference,extra)`
- Produces: `export function decide(s: State, decision: string, reference: string, opts?: { escalate?: boolean }): State`

- [ ] **Step 1: Write the failing test**

```ts
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
 expect(()=>decide(s,"approve","human",{escalate:true})).toThrow("Escalation");
 let f=initial("test");
 f=complete(f,"brainstorm","digest","PASS");
 expect(()=>decide(f,"revise","human",{escalate:true})).toThrow("Escalation");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/harness.test.ts -t "escalation"`
Expected: FAIL — `decide` 가 네 번째 인자를 받지 않으므로 `e.track` 이 `"light"` 로 남는다.

- [ ] **Step 3: Write minimal implementation**

`src/harness.ts` 의 `decide` 를 교체한다.

```ts
export function decide(s:State,decision:string,reference:string,opts:{escalate?:boolean}={}):State {
 const ps=phasesFor(s);
 if(!s.phase.endsWith("-gate")) throw Error("No pending gate");
 if(!["approve","revise","cancel"].includes(decision)) throw Error("Expected approve, revise, cancel");
 if(opts.escalate&&!(decision==="revise"&&s.phase==="plan-gate"&&(s.track??"full")==="light")) throw Error("Escalation requires revising a light-track plan gate");
 const n=record(s,decision,reference,opts.escalate?{escalatedTo:"full",waived:["product-gate"]}:{});
 if(decision==="cancel") n.phase="cancelled";
 else if(decision==="approve") n.phase=ps[ps.indexOf(s.phase)+1]!;
 else if(opts.escalate) {
  n.track="full"; n.phase="design";
  for(const p of TRACKS.full.slice(TRACKS.full.indexOf("design"))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
  delete n.snapshot;
 }
 else { n.phase=s.phase==="uat-gate" ? "build" : ps[ps.indexOf(s.phase)-1]!;
  for(const p of ps.slice(ps.indexOf(n.phase))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
  delete n.snapshot;
 }
 return n;
}
```

강등 경로는 만들지 않는다 (설계 §5.1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/harness.ts src/harness.test.ts
git commit -m "feat(harness): escalate a light run to the full track at the plan gate"
```

---

## Task 3: 태스크 단위 수정 라운드

**Files:**
- Modify: `src/harness.ts` (`retry`), `src/project.ts`, `harness.config.json`
- Test: `src/harness.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `record(s,action,reference,extra)`, `phasesFor`
- Produces:
  - `export type Limits = { maxFixRounds: number; maxTotalFixRounds: number }`
  - `export const DEFAULT_LIMITS: Limits` (`{maxFixRounds:5,maxTotalFixRounds:15}`)
  - `export function retry(s: State, findings: string, task: string, limits?: Limits): State`
  - `src/project.ts` 의 `export function fixLimits(root: string): Limits`

- [ ] **Step 1: Write the failing test**

기존 `fix circuit breaker stops a fourth automatic retry` 테스트는 **삭제하지 말고 교체한다** — 동작이 바뀌었으므로 같은 의도를 새 계약으로 다시 쓴다.

```ts
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
```

기존 테스트(39~43행)는 아래로 바꾼다.

```ts
test("a lower configured limit stops the retry earlier",()=>{
 let s=initial("test");s.phase="build";
 const limits={maxFixRounds:2,maxTotalFixRounds:15};
 s=retry(s,"finding","T1",limits);s=retry(s,"finding","T1",limits);
 expect(()=>retry(s,"again","T1",limits)).toThrow("Task T1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/harness.test.ts -t "fix rounds"`
Expected: FAIL — `retry` 가 3번째 인자를 받지 않아 4회차에서 `Three fix rounds` 로 던진다.

- [ ] **Step 3: Write minimal implementation**

`src/harness.ts` 의 `retry` 를 교체한다.

```ts
export type Limits = { maxFixRounds:number; maxTotalFixRounds:number };
export const DEFAULT_LIMITS:Limits = {maxFixRounds:5,maxTotalFixRounds:15};
export function retry(s:State,findings:string,task:string,limits:Limits=DEFAULT_LIMITS):State {
 const ps=phasesFor(s);
 if(!["build","review","browser-qa","verification","uat-gate"].includes(s.phase)) throw Error("Retry only within delivery");
 if(!task.trim()) throw Error("Retry requires --task <task-id> so rounds can be counted per task");
 const all=s.history.filter(h=>h.action==="retry");
 if(all.filter(h=>h.task===task).length>=limits.maxFixRounds) throw Error(`Task ${task}: ${limits.maxFixRounds} fix rounds exhausted; obtain revised human plan`);
 if(all.length>=limits.maxTotalFixRounds) throw Error(`${limits.maxTotalFixRounds} total fix rounds exhausted; obtain revised human plan`);
 const n=record(s,"retry",findings,{task}); n.phase="build"; delete n.snapshot;
 for(const p of ps.slice(ps.indexOf("build"))) { delete n.evidence[p]; if(n.approvedArtifacts)delete n.approvedArtifacts[p]; }
 return n;
}
```

`src/project.ts` 끝에 추가한다.

```ts
import type { Limits } from "./harness.ts";
export function fixLimits(root:string):Limits {
 const config=JSON.parse(readFileSync(resolve(root,"harness.config.json"),"utf8"));
 const read=(v:unknown,fallback:number,name:string):number=>{
  if(v===undefined)return fallback;
  if(!Number.isInteger(v)||(v as number)<1)throw Error(name+" must be a positive integer");
  return v as number;
 };
 return {maxFixRounds:read(config.maxFixRounds,5,"maxFixRounds"),maxTotalFixRounds:read(config.maxTotalFixRounds,15,"maxTotalFixRounds")};
}
```

`src/cli.ts:81` 을 바꾼다. `--task` 를 인자에서 뽑고 나머지를 findings 로 쓴다.

```ts
 } else if(command==="retry") {
  const i=args.indexOf("--task");
  const task=i>=0?(args[i+1]??""):"";
  const findings=(i>=0?[...args.slice(0,i),...args.slice(i+2)]:args).join(" ");
  save(root,retry(s,findings,task,fixLimits(root)));
 }
```

`src/cli.ts:7` 의 import 에 `fixLimits` 를 더하고, `help` 문자열의 `retry <findings>` 를 `retry <findings> --task <task-id>` 로 바꾼다.

`harness.config.json` 을 바꾼다.

```json
  "maxFixRounds": 5,
  "maxTotalFixRounds": 15,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/harness.ts src/project.ts src/cli.ts src/harness.test.ts harness.config.json
git commit -m "feat(harness): count fix rounds per task and read the configured limits"
```

---

## Task 4: code root 분리 — worktree 가 상태를 가져가지 않는다

**Files:**
- Modify: `src/store.ts:23-24`, `src/cli.ts:82-89`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `State.worktree`, `State.worktreeBranch`
- Produces: `src/store.ts` 의 `export function codeRoot(stateRoot: string, s: State): string` — `s.worktree` 가 있으면 그 realpath, 없으면 `stateRoot` 의 realpath

- [ ] **Step 1: Write the failing test**

`src/cli.test.ts` 에 새 테스트를 추가한다.

```ts
test("worktree creation keeps the run in the main checkout",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-split-"));const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 const cli=(...a:string[])=>Bun.spawnSync([process.execPath,join(import.meta.dir,"cli.ts"),...a],{cwd:root});
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  expect(cli("setup").exitCode).toBe(0);
  expect(cli("configure",'[["bun","test"]]').exitCode).toBe(0);
  expect(cli("init","sample").exitCode).toBe(0);
  const s=load(root);s.phase="worktree";s.workflowVersion=undefined;writeFileSync(join(root,".harness/state.json"),JSON.stringify({...s,root:realpathSync(root)},null,2));
  git(root,"add",".");git(root,"commit","-m","planning");
  expect(cli("worktree",wt,"feature/sample").exitCode).toBe(0);
  const after=load(root);
  expect(after.phase).toBe("build");
  expect(after.worktree).toBe(realpathSync(wt));
  expect(after.worktreeBranch).toBe("feature/sample");
  expect(existsSync(join(wt,".harness/state.json"))).toBe(false);
 }finally{rmSync(base,{recursive:true,force:true});}
});
```

`src/cli.test.ts` 상단 import 에 `existsSync` 를 더한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli.test.ts -t "keeps the run in the main checkout"`
Expected: FAIL — 현재 구현이 메인 상태를 `phase:"transferred"` 로 바꾸므로 `after.phase` 가 `"transferred"` 이고, worktree 에 `state.json` 이 생긴다.

- [ ] **Step 3: Write minimal implementation**

`src/store.ts` 끝에 추가한다.

```ts
export function codeRoot(stateRoot:string,s:State):string {
 return realpathSync(s.worktree??stateRoot);
}
```

`src/cli.ts` 의 `worktree` 명령(82~89행)을 교체한다.

```ts
  else if(command==="worktree") {
   if(s.phase!=="worktree")throw Error("Plan approval required");
   checkApprovals(root,s);
   const [path,branch]=args;if(!path?.startsWith("/")||!branch)throw Error(help);
   if(git(root,"status","--porcelain"))throw Error("Commit planning artifacts before creating worktree");
   git(root,"worktree","add","-b",branch,path,"HEAD");
   s=complete(s,"worktree","git worktree "+path,"PASS");
   s.worktree=git(path,"rev-parse","--show-toplevel");s.worktreeBranch=branch;
   save(root,s);
   console.log("Worktree ready at "+s.worktree+"\nAdd it to this session instead of restarting Claude: /add-dir "+s.worktree);
  }
```

`s.root` 는 건드리지 않는다 — 메인 체크아웃이 계속 상태의 주인이다. `save(path,s)` 와 `transferred` 는 삭제한다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: 신규 테스트는 PASS. 기존 `CLI blocks wrong phase, detects changed approved docs, and transfers an isolated run` 은 **이 시점에 FAIL 할 수 있다** — `transferred` 를 기대하거나 worktree 에서 상태를 읽기 때문이다. 그 기대를 새 계약으로 고친다: `expect(load(root).phase).toBe("build")` 로 바꾸고, worktree 쪽 `load(wt)` 호출은 `load(root)` 로 바꾸며, 테스트 이름에서 `and transfers an isolated run` 을 `and records the worktree` 로 바꾼다. 배송 단계 명령을 거는 부분은 Task 5 에서 라우팅이 붙은 뒤에 통과하므로, 이 태스크에서는 그 부분을 `test.todo` 로 잠시 분리하지 말고 **Task 5 와 묶어 한 번에 고친다** — 즉 이 태스크의 커밋 전에 Task 5 의 Step 3 까지 적용해도 된다. 분리가 어려우면 Task 4 와 Task 5 를 하나의 커밋으로 합친다.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/cli.ts src/cli.test.ts
git commit -m "feat(harness): keep run state in the main checkout after worktree creation"
```

---

## Task 5: 배송 단계 연산을 worktree 로 라우팅

**Files:**
- Modify: `src/cli.ts:19,20,36-75`, `src/evidence.ts:5-18`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `codeRoot(stateRoot, s)`
- Produces: `src/evidence.ts` 의 `export function evidence(stateRoot: string): void` — 시그니처는 그대로지만 내부에서 code root 를 쓴다

- [ ] **Step 1: Write the failing test**

```ts
test("delivery evidence and fingerprints come from the worktree",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-route-"));const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");writeFileSync(join(root,"source.ts"),"export const a=1;\n");
  git(root,"add",".");git(root,"commit","-m","initial");
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const s=initial("sample");s.root=realpathSync(root);s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";
  expect(codeRoot(root,s)).toBe(realpathSync(wt));
  const before=fingerprint(codeRoot(root,s));
  writeFileSync(join(wt,"source.ts"),"export const a=2;\n");
  expect(fingerprint(codeRoot(root,s))).not.toBe(before);
  expect(fingerprint(root)).toBe(before);
 }finally{rmSync(base,{recursive:true,force:true});}
});
```

`src/cli.test.ts` import 에 `codeRoot` 와 `initial` 을 더한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli.test.ts -t "come from the worktree"`
Expected: FAIL — `codeRoot` 가 아직 import 되지 않았다면 타입 오류, 혹은 Task 4 를 건너뛴 경우 `codeRoot is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/cli.ts:36` 바로 뒤에 code root 를 만든다.

```ts
  let s=load(root);
  const code=codeRoot(root,s);
```

그리고 아래 참조를 바꾼다. **상태·잠금·원장은 `root`, 제품 트리는 `code` 다.**

| 위치 | 바꾸기 전 | 바꾼 뒤 |
|---|---|---|
| `cli.ts:46` | `artifact(root,path)` | `artifact(code,path)` |
| `cli.ts:48` | `checkApprovals(root,s)` | `checkApprovals(code,s)` |
| `cli.ts:50` | `bindApproval(root,phase,path)` | `bindApproval(code,phase,path)` |
| `cli.ts:52-53` | `artifact(root,designPath)` | `artifact(code,designPath)` |
| `cli.ts:58` | `artifact(root,p!)` | `artifact(code,p!)` |
| `cli.ts:60` | `if(s.worktree!==root)throw …` | `if(!s.worktree)throw Error("Delivery must run in an approved worktree")` |
| `cli.ts:62,70,71` | `fingerprint(root)` | `fingerprint(code)` |
| `cli.ts:62` | `git(root,"rev-parse","HEAD")` | `git(code,"rev-parse","HEAD")` |
| `cli.ts:65,66,67` | `…(root,…)` | `…(code,…)` |
| `cli.ts:72` | `git(root,"status","--porcelain")` | `git(code,"status","--porcelain")` |
| `cli.ts:77,78,79` | `checkApprovals(root,s)`·`artifact(root,…)`·`fingerprint(root)` | `code` 로 |

`status`·`fingerprint`·`evidence` 는 `load` 보다 먼저 분기하므로(17~21행) 각자 상태를 읽어 code root 를 구한다.

```ts
 else if(command==="evidence")evidence(root);
 else if(command==="fingerprint")console.log(fingerprint(existsSync(statePath(root))?codeRoot(root,load(root)):root));
```

`src/evidence.ts` 를 교체한다.

```ts
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
```

import 에 `codeRoot` 를 더한다. `src/cli.ts` 의 import 에도 `codeRoot` 를 더한다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS. 기존 `cli.test.ts` 의 배송 단계 흐름이 worktree 를 대상으로 돌게 되므로, 그 테스트가 worktree 에 소스/보고서를 쓰도록 경로를 맞춘다.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/evidence.ts src/cli.test.ts
git commit -m "feat(harness): route delivery phases at the worktree while state stays in main"
```

---

## Task 6: 저장소 제어 — 두 root 와 worktree 단언

**Files:**
- Modify: `src/repository-control.ts:33-103`, `src/cli.ts:37-38`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `codeRoot`, `State.worktreeBranch`
- Produces:
  - `export function repositoryGate(stateRoot: string, reportPath: string, scopePath: string)` — 시그니처 유지, 내부에서 code root 유도
  - `export function repositoryCommit(stateRoot: string, token: string)` — 동일
  - `export function validateTaskCommits(stateRoot: string, tasks: any): void` — 동일
  - `requireWorktree(stateRoot, s): string` (모듈 내부)

**근거:** 설계 §5.2 — 컨트롤러가 메인에 남으면 "메인을 건드릴 수 없음" 이라는 암묵적 보장이 사라지므로 명시적 단언으로 대체한다. 수용 기준 6·7 이 이 태스크의 산출이다.

- [ ] **Step 1: Write the failing test**

```ts
test("controller commits land in the worktree and never move main",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-commit-"));const root=join(base,"repo"),wt=join(base,"wt");mkdirSync(root);
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");mkdirSync(join(root,"docs/development/sample"),{recursive:true});
  writeFileSync(join(root,"docs/development/sample/product.md"),"reviewable product");
  writeFileSync(join(root,"docs/development/sample/qa.md"),"QA-E2E-001\nGiven: fixture\nWhen: run\nThen: exits 0\n");
  writeFileSync(join(root,"harness.config.json"),JSON.stringify({version:1,mode:"claude-only",verificationCommands:[["bun","test"]]},null,2));
  git(root,"add",".");git(root,"commit","-m","initial");
  git(root,"worktree","add","-b","feature/x",wt,"HEAD");
  const mainHead=git(root,"rev-parse","HEAD");
  const s=initial("sample");s.root=realpathSync(root);s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";s.phase="build";
  mkdirSync(join(root,".harness"),{recursive:true});save(root,s);
  writeFileSync(join(wt,"task.txt"),"work\n");
  writeFileSync(join(root,".harness/worker.json"),JSON.stringify({task:"T1",executor:"codex",status:"READY_FOR_COMMIT",implementation:{status:"complete"},verification:{red:{status:"passed",command:"fixture RED",evidence:"expected assertion failure"},green:{status:"passed",command:"fixture GREEN",tests_passed:1},typecheck:{status:"passed",command:"fixture static check"}},changed_files:["task.txt"],proposed_commit_message:"feat: task",notes:[]}));
  writeFileSync(join(root,".harness/scope.json"),JSON.stringify({task:"T1",allowed_files:["task.txt"]}));
  const gate=repositoryGate(root,".harness/worker.json",".harness/scope.json");
  const entry=repositoryCommit(root,gate.token);
  expect(git(wt,"rev-parse","HEAD")).toBe(entry.commit.sha);
  expect(git(root,"rev-parse","HEAD")).toBe(mainHead);
  expect(git(wt,"rev-parse","--abbrev-ref","HEAD")).toBe("feature/x");
 }finally{rmSync(base,{recursive:true,force:true});}
});
test("a run without an approved worktree cannot commit",()=>{
 const base=mkdtempSync(join(tmpdir(),"harness-noworktree-"));const root=join(base,"repo");mkdirSync(root);
 try{
  git(root,"init");git(root,"config","user.email","t@example.invalid");git(root,"config","user.name","T");
  writeFileSync(join(root,".gitignore"),".harness/\n");git(root,"add",".");git(root,"commit","-m","initial");
  const s=initial("sample");s.root=realpathSync(root);s.phase="build";save(root,s);
  expect(()=>repositoryGate(root,".harness/worker.json",".harness/scope.json")).toThrow("worktree");
 }finally{rmSync(base,{recursive:true,force:true});}
});
```

import 에 `save` 와 `initial` 을 더한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli.test.ts -t "never move main"`
Expected: FAIL — `requireBuild` 가 `s.worktree!==root` 로 거부한다 (상태 root 는 메인, worktree 는 다른 경로).

- [ ] **Step 3: Write minimal implementation**

`src/repository-control.ts` 의 import 에 `codeRoot` 를 더하고, `requireBuild` 를 교체한다.

```ts
function requireWorktree(stateRoot:string,s:State):string {
 if(!s.worktree)throw Error("Approved build worktree required");
 const code=codeRoot(stateRoot,s);
 if(code===realpathSync(stateRoot))throw Error("Delivery must not target the main checkout");
 if(realpathSync(git(code,"rev-parse","--show-toplevel"))!==code)throw Error("Approved worktree path is not a worktree root");
 if(git(code,"rev-parse","--abbrev-ref","HEAD")!==s.worktreeBranch)throw Error("Worktree is not on the approved branch");
 return code;
}
function requireBuild(stateRoot:string):string {
 const s=load(stateRoot);
 const code=requireWorktree(stateRoot,s);
 checkApprovals(code,s);
 if(s.phase!=="build")throw Error("Approved build worktree required");
 for(const entry of Object.values(s.evidence)) {
  const [path,hash]=entry.split("#sha256=");
  if(hash&&artifact(code,path!).hash!==hash)throw Error("Approved evidence changed; revise its gate");
 }
 const hash=(s as {configHash?:string}).configHash;
 if(hash&&digest(readFileSync(resolve(code,"harness.config.json")))!==hash)throw Error("Approved verification configuration changed");
 return code;
}
```

`import type { State } from "./harness.ts";` 를 추가한다.

`snapshot` 이 두 root 를 받게 한다 — **보고서와 범위는 `.harness/` 이므로 state root, git 은 code root** 다.

```ts
function snapshot(stateRoot:string,code:string,reportPath:string,scopePath:string) {
 const report=JSON.parse(readFileSync(resolve(stateRoot,reportPath),"utf8"));validateWorker(report);
 const scope=JSON.parse(readFileSync(resolve(stateRoot,scopePath),"utf8"));
 if(scope.task!==report.task)throw Error("Scope task mismatch");
 const allowed=files(scope.allowed_files), actual=changedFiles(code);
 if(!same(actual,report.changed_files)||actual.some(p=>!allowed.includes(p)))throw Error("Unexpected/missing files: reconcile actual diff, report and controller-owned scope");
 if(raw(code,"diff","--cached","--name-only").trim())throw Error("Pre-existing staged changes: reconcile index before gate");
 for(const p of actual){
  if(/(^|\/)(\.env(?:\..*)?|credentials?(?:[./]|$))|\.(pem|key|p12)$/i.test(p))throw Error("Sensitive file requires separate explicit controller review: "+p);
  const full=resolve(code,p);
  if(existsSync(full)&&(lstatSync(full).isSymbolicLink()||!lstatSync(full).isFile()))throw Error("Symlink/submodule requires separate controller review: "+p);
 }
 raw(code,"diff","--check","HEAD");
 const state={head:git(code,"rev-parse","HEAD"),report,scope,status:raw(code,"status","--short"),diff:raw(code,"diff","--binary","HEAD"),contents:actual.map(p=>[p,existsSync(resolve(code,p))?digest(readFileSync(resolve(code,p))):"deleted"])};
 return {report,actual,state,token:digest(JSON.stringify(state))};
}
```

`repositoryGate` 와 `repositoryCommit` 을 교체한다.

```ts
export function repositoryGate(stateRoot:string,reportPath:string,scopePath:string) {
 stateRoot=realpathSync(stateRoot);const code=requireBuild(stateRoot);
 const result=snapshot(stateRoot,code,reportPath,scopePath);
 writeFileSync(resolve(stateRoot,".harness/repository-gate.json"),JSON.stringify({reportPath,scopePath,token:result.token}));
 return {token:result.token,...result.state,changed_files:result.actual};
}
export function repositoryCommit(stateRoot:string,token:string) {
 stateRoot=realpathSync(stateRoot);const code=requireBuild(stateRoot);
 const mainHead=git(stateRoot,"rev-parse","HEAD");
 const g=JSON.parse(readFileSync(resolve(stateRoot,".harness/repository-gate.json"),"utf8"));
 const x=snapshot(stateRoot,code,g.reportPath,g.scopePath);
 if(token!==g.token||token!==x.token)throw Error("Repository gate stale; inspect a new gate before commit");
 git(code,"--literal-pathspecs","add","--",...x.actual);
 if(!same(raw(code,"diff","--cached","--name-only","--no-renames","-z").split("\0").filter(Boolean),x.actual))throw Error("Staged scope changed; inspect index, do not retry blindly");
 git(code,"diff","--cached","--check");
 for(const [p,hash] of x.state.contents) {
  if(hash!=="deleted"&&digest(Bun.spawnSync(["git","-C",code,"show",":"+p],{stdout:"pipe",stderr:"pipe"}).stdout)!==hash)throw Error("Staged content changed; inspect index before retry");
 }
 if(git(code,"rev-parse","HEAD")!==x.state.head)throw Error("HEAD changed during staging");
 git(code,"commit","-m",x.report.proposed_commit_message);
 const sha=git(code,"rev-parse","HEAD");
 if(git(code,"rev-parse",sha+"^")!==x.state.head||!same(raw(code,"diff","--name-only","--no-renames","-z",x.state.head,sha).split("\0").filter(Boolean),x.actual))throw Error("Commit hook changed scope/parent; reconcile committed result before review");
 for(const [p,hash] of x.state.contents) {
  if(hash!=="deleted"&&digest(Bun.spawnSync(["git","-C",code,"show",sha+":"+p],{stdout:"pipe",stderr:"pipe"}).stdout)!==hash)throw Error("Commit hook changed contents; reconcile committed result before review");
 }
 if(git(stateRoot,"rev-parse","HEAD")!==mainHead)throw Error("Main checkout HEAD moved during a worktree commit; inspect both trees before continuing");
 const entry={run_id:load(stateRoot).id,task:x.report.task,executor:x.report.executor,committer:"controller",repository_control:{mode:"controller_managed"},base_commit:x.state.head,commit:{sha,message:x.report.proposed_commit_message},changed_files:x.actual,worker_report:x.report};
 const path=resolve(stateRoot,".harness/repository-ledger.json");
 const ledger=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):[];
 ledger.push(entry);writeFileSync(path,JSON.stringify(ledger,null,2)+"\n");
 return entry;
}
```

`validateTaskCommits` 도 두 root 로 바꾼다 — 원장은 state root, git 은 code root.

```ts
export function validateTaskCommits(stateRoot:string,tasks:any):void {
 const s=load(stateRoot);const code=codeRoot(stateRoot,s);
 if(changedFiles(code).some(p=>!p.startsWith("docs/development/")))throw Error("Uncommitted product changes cannot pass immutable review");
 if(!Array.isArray(tasks)||!tasks.length)throw Error("Controller commit ledger and immutable review required");
 const path=resolve(stateRoot,".harness/repository-ledger.json");
 const ledger=(existsSync(path)?JSON.parse(readFileSync(path,"utf8")):[]).filter((e:any)=>e.run_id===s.id);
 if(!ledger.length||git(code,"rev-parse","HEAD")!==ledger.at(-1).commit.sha)throw Error("HEAD must equal the latest controller commit");
 for(const t of tasks){
  const entry=ledger.filter((e:any)=>e.task===t.id).at(-1);
  if(!entry||t.executor!==entry.executor||t.committer!=="controller"||t.repository_control?.mode!=="controller_managed"||t.commit?.sha!==entry.commit.sha||t.base_commit!==entry.base_commit||t.review_commit!==entry.commit.sha||t.review_verdict!=="PASS"||!nonempty(t.review))throw Error("Task requires latest controller commit and independent PASS for that immutable commit");
  if(git(code,"rev-parse",entry.commit.sha+"^")!==entry.base_commit)throw Error("Task commit parent mismatch");
  git(code,"merge-base","--is-ancestor",entry.commit.sha,"HEAD");
 }
 if(ledger.some((e:any)=>!tasks.some((t:any)=>t.id===e.task)))throw Error("Build omits a committed task");
}
```

`src/cli.ts:65` 의 `validateTaskCommits(root,r.tasks)` 는 `root` 그대로 둔다 (이제 state root 를 받는다).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repository-control.ts src/cli.ts src/cli.test.ts
git commit -m "feat(harness): commit into the approved worktree and assert main never moves"
```

---

## Task 7: 훅이 worktree 산출물 경로를 허용

**Files:**
- Modify: `src/hook.ts:7-14`
- Test: `src/store.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `State.worktree`
- Produces: `guard` 의 동작 변경만. 시그니처 유지 — `export function guard(input, root): string|undefined`

- [ ] **Step 1: Write the failing test**

```ts
test("hook allows development artifacts in the approved worktree",()=>{
 const root=mkdtempSync(join(tmpdir(),"harness-hookwt-")),wt=mkdtempSync(join(tmpdir(),"harness-hookwt-code-"));
 try{
  const s=initial("sample");s.phase="build";s.worktree=realpathSync(wt);s.worktreeBranch="feature/x";save(root,s);
  mkdirSync(join(wt,"docs/development"),{recursive:true});
  expect(guard({tool_name:"Write",tool_input:{file_path:join(wt,"docs/development/build.json")}},root)).toBeUndefined();
  expect(guard({tool_name:"Write",tool_input:{file_path:join(wt,"src/code.ts")}},root)).toContain("Codex only");
  expect(guard({tool_name:"Write",tool_input:{file_path:join(wt,".harness/state.json")}},root)).toContain("coordinator-managed");
 }finally{rmSync(root,{recursive:true,force:true});rmSync(wt,{recursive:true,force:true});}
});
```

`src/store.test.ts` import 에 `realpathSync` 와 `mkdirSync` 를 더한다 (`mkdirSync` 는 이미 있다).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store.test.ts -t "approved worktree"`
Expected: FAIL — `!within(root,actual)` 이 worktree 경로를 거부해 `coordinator-managed` 를 돌려준다.

- [ ] **Step 3: Write minimal implementation**

`src/hook.ts` 의 Write/Edit 블록을 교체한다.

```ts
 if(["Write","Edit","MultiEdit","NotebookEdit"].includes(tool)) {
  const path=resolve(input.cwd??root,String(data.file_path??data.notebook_path??""));
  let ancestor=path;while(!existsSync(ancestor))ancestor=dirname(ancestor);
  const actual=resolve(realpathSync(ancestor),relative(ancestor,path));
  let worktree:string|null=null;
  try{const w=load(root).worktree;worktree=w?realpathSync(w):null;}catch{}
  const trees=[root,...(worktree?[worktree]:[])];
  const owner=trees.find(t=>within(t,actual));
  if(!owner||within(resolve(owner,".harness"),actual)||within(resolve(owner,".claude"),actual)||actual===resolve(owner,"harness.config.json"))return "Harness configuration/state is coordinator-managed; use the harness CLI.";
  if(!within(resolve(owner,"docs/development"),actual))return "Application edits belong to Codex only, after approved plan and worktree. Claude coordinates and writes planning/review reports; delegate all code and test changes through codex:codex-rescue.";
 }
```

`src/hook.ts` 의 import 에 `load` 는 이미 있다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS. 기존 `hook rejects source writes before approval and symlink parent escapes` 도 통과해야 한다 — 상태가 없으면 `worktree` 가 `null` 이라 기존 동작과 같다.

- [ ] **Step 5: Commit**

```bash
git add src/hook.ts src/store.test.ts
git commit -m "feat(harness): let the guard accept development artifacts in the approved worktree"
```

---

## Task 8: worktree 의존성 준비(백그라운드)

**Files:**
- Create: `src/prepare.ts`
- Create: `src/prepare.test.ts`
- Modify: `src/cli.ts` (`worktree` 명령, `complete build` 전제, `help`)

**Interfaces:**
- Consumes: Task 4 의 `worktree` 명령
- Produces:
  - `export function prepareCommand(worktree: string): string[] | null`
  - `export function startPrepare(stateRoot: string, worktree: string): void`
  - `export function prepareStatus(stateRoot: string): { state: "ok"|"failed"|"running"|"skipped"|"missing"; [k: string]: unknown }`

- [ ] **Step 1: Write the failing test**

`src/prepare.test.ts` 를 만든다.

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/prepare.test.ts`
Expected: FAIL — `Cannot find module './prepare.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/prepare.ts` 를 만든다. 배경 프로세스가 CLI 보다 오래 살아야 하므로 상태 파일은 **그 프로세스가 직접** 쓴다 — CLI 의 `exited` 콜백은 CLI 종료와 함께 사라진다.

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export function prepareCommand(worktree:string):string[]|null {
 if(existsSync(resolve(worktree,"bun.lock"))||existsSync(resolve(worktree,"bun.lockb")))return ["bun","install","--frozen-lockfile"];
 if(existsSync(resolve(worktree,"pnpm-lock.yaml")))return ["pnpm","install","--frozen-lockfile"];
 if(existsSync(resolve(worktree,"yarn.lock")))return ["yarn","install","--immutable"];
 if(existsSync(resolve(worktree,"package-lock.json")))return ["npm","ci"];
 if(existsSync(resolve(worktree,"package.json")))return ["npm","install"];
 return null;
}
function statusPath(stateRoot:string):string {return resolve(stateRoot,".harness/worktree-prepare.json");}
export function prepareStatus(stateRoot:string):{state:string;[k:string]:unknown} {
 const p=statusPath(stateRoot);
 if(!existsSync(p))return {state:"missing"};
 try{return JSON.parse(readFileSync(p,"utf8"));}catch{return {state:"failed",reason:"unreadable prepare status"};}
}
export function startPrepare(stateRoot:string,worktree:string):void {
 mkdirSync(resolve(stateRoot,".harness"),{recursive:true});
 const argv=prepareCommand(worktree);
 if(!argv){writeFileSync(statusPath(stateRoot),JSON.stringify({state:"skipped",reason:"no recognised manifest or lockfile"})+"\n");return;}
 const q=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 const log=resolve(stateRoot,".harness/worktree-prepare.log");
 writeFileSync(statusPath(stateRoot),JSON.stringify({state:"running",command:argv.join(" "),startedAt:new Date().toISOString()})+"\n");
 const script=`${argv.map(q).join(" ")} > ${q(log)} 2>&1; code=$?; if [ $code -eq 0 ]; then state=ok; else state=failed; fi; printf '{"state":"%s","command":%s,"exitCode":%d,"log":%s}\\n' "$state" ${q(JSON.stringify(argv.join(" ")))} "$code" ${q(JSON.stringify(log))} > ${q(statusPath(stateRoot))}`;
 Bun.spawn(["sh","-c",script],{cwd:worktree,stdin:"ignore",stdout:"ignore",stderr:"ignore"}).unref();
}
```

`src/cli.ts` 의 `worktree` 명령에서 `save` 뒤에 한 줄을 더한다.

```ts
   startPrepare(root,s.worktree);
```

그리고 `complete build` 전제에 준비 상태 검사를 넣는다. `cli.ts:59` 블록 안, `if(!s.worktree)` 단언 바로 뒤.

```ts
    if(phase==="build") {
     const prep=prepareStatus(root);
     if(!["ok","skipped"].includes(prep.state))throw Error("Worktree preparation is "+prep.state+"; inspect .harness/worktree-prepare.log and rerun `prepare` before completing build");
    }
```

`prepare` 재실행 명령을 추가한다. `repository-commit` 분기 바로 뒤.

```ts
  if(command==="prepare") {
   if(!s.worktree)throw Error("Approved worktree required");
   startPrepare(root,s.worktree);console.log(JSON.stringify(prepareStatus(root)));return;
  }
  if(command==="prepare-status") {console.log(JSON.stringify(prepareStatus(root),null,2));return;}
```

`help` 문자열에 `| prepare | prepare-status` 를 더하고, import 에 `startPrepare, prepareStatus` 를 더한다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run check`
Expected: PASS. `cli.test.ts` 의 worktree 픽스처에는 `package.json` 이 없으므로 준비 상태가 `skipped` 가 되어 build 가 막히지 않는다.

- [ ] **Step 5: Commit**

```bash
git add src/prepare.ts src/prepare.test.ts src/cli.ts
git commit -m "feat(harness): prepare the new worktree in the background and gate build on it"
```

---

## Self-Review

**1. Spec coverage** — 설계 문서의 1단계 범위(§7 "척추" = §5.1 트랙 · §5.2 격리 · §5.5 재시도)를 수용 기준으로 대조했다.

| 수용 기준 | 태스크 |
|---|---|
| 1 (light 가 설계 구간을 건너뜀) | Task 1 |
| 2 (트랙별 거부 목적지) | Task 1 |
| 3 (승격 전이와 면제 기록) | Task 2 |
| 5 (worktree 후 상태가 메인에 살아있음) | Task 4 |
| 6 (worktree 에 커밋, 메인 HEAD 불변) | Task 6 |
| 7 (잘못된 대상 거부) | Task 6 |
| 15, 16, 17 (태스크 단위·설정값·전체 상한) | Task 3 |
| 19 (`track` 없는 기존 상태가 `full`) | Task 1 |

Task 7(훅 worktree 허용)은 처음에 대응하는 수용 기준이 없었다 — 설계 §5.2 표의 `hook.ts:11-12` 행에서만 요구됐다. 이 리뷰에서 설계 문서에 **기준 20** 을 추가했다: "승인된 worktree 의 `docs/development/**` 쓰기를 훅이 허용하고, 같은 worktree 의 소스 쓰기와 `.harness/**` 쓰기는 계속 거부한다." → Task 7.

**미포함 (의도적)** — 기준 4(경량 설계 번들 흡수)는 `workflow-contract.ts:bindApproval` 변경이므로 2단계 노브 작업과 파일이 겹친다. 기준 8~14, 18 은 2·3단계다.

**2. Placeholder scan** — 모든 Step 3 가 실제 코드를 담고 있고, "적절한 에러 처리" 류 표현이 없다. Task 4 Step 4 에 기존 테스트 수정 방침이 산문으로 남아 있으나, 이는 기존 테스트의 어느 기대를 어떻게 바꿀지 구체적으로 적시했으므로 플레이스홀더가 아니다.

**3. Type consistency** — `codeRoot(stateRoot, s)` 인자 순서가 Task 4·5·6·7 에서 일관된다. `retry(s, findings, task, limits)` 가 Task 3 과 `cli.ts` 호출부에서 일치한다. `Limits` 는 `harness.ts` 에서 export 하고 `project.ts` 가 타입만 import 한다. `requireBuild` 가 이제 `string` 을 반환하므로 `repositoryGate`·`repositoryCommit` 두 호출부 모두 반환값을 받는다. `prepareStatus` 반환 타입의 `state` 는 문자열이며 `complete build` 검사가 `["ok","skipped"].includes` 로 좁힌다.

---

## 2단계·3단계

이 계획은 1단계만 다룬다. 2단계(에이전트 설정 · `dispatch` · 리모트 전달)는 Task 5·6 이 확정한 두 root 시그니처와 Task 1 의 `record(extra)` 위에 쓰여야 하므로, 1단계가 머지된 뒤에 계획을 쓴다.

2단계에서 먼저 확인할 것 — `src/store.test.ts:31-33` 은 승인 차단을 3가지 호출 형태로 검증한다. 설계 §5.4 의 P8 수정(heredoc 본문 제외)은 **그 3개를 계속 통과시키면서** 본문 안의 문자열만 통과시켜야 한다. 좁히기가 과하면 차단이 뚫리므로, 수용 기준 12 와 14 를 같은 테스트에서 함께 단언한다.

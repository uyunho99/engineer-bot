# 하네스 v2 설계 — 트랙 분리 · 에이전트 플러거블화 · 리모트 승인

> 작성 2026-10-23 · 대상 브랜치 `harness/controller-managed-git` · 기준 커밋 `83e310f`
> 전역 설치본(`~/.claude/skills/development-harness-native/`)이 이 브랜치에서 나왔음을 확인함

---

## 1. 문제 정의

현재 하네스는 **한 종류의 작업만 상정한다** — 기획부터 UAT까지 사람 승인 4회를 거치는 큰 기능 개발이다.
그리고 구현자를 Codex 하나로 고정하고, 승인을 그 체크아웃의 터미널에 묶고, 수정 재시도를 실행 전체 3회로 막는다.

다섯 가지가 실제로 물린다.

| # | 증상 | 강제 지점 |
|---|---|---|
| P1 | 1줄짜리 핫픽스도 게이트 4개와 설계 문서를 전부 거쳐야 한다 | `src/harness.ts:1` `phases` 배열이 단일 경로다 |
| P2 | 구현자가 Codex로 고정이다. 팀원이 다른 엔진을 쓰면 계약 검증이 거부한다 | `src/cli.ts:64`, `src/workflow-contract.ts:45`, `src/doctor.ts:12,15,16` |
| P3 | 리모트에서 승인할 수 없다. 그 체크아웃의 터미널까지 가야 한다 | `src/hook.ts:20` 이 승인 명령을 담은 Bash 를 거부한다 |
| P4 | 수정 재시도가 실행 전체 3회다. 태스크 단위가 아니다 | `src/harness.ts:retry()` 의 하드코딩 `>=3` |
| P5 | worktree 를 만들면 `cd` 후 Claude 를 재실행해야 해서 세션 맥락이 끊긴다 | `src/store.ts:load()` 의 `s.root!==root`, `src/cli.ts:60` 의 `s.worktree!==root` |

배포 과정에서 추가로 드러난 결함도 같이 고친다.

| # | 증상 |
|---|---|
| P6 | GitHub 기본 브랜치는 `claude-only` 인데 실제 설치본은 `harness/controller-managed-git` 이다. README 절차를 그대로 따르면 구버전이 설치된다 |
| P7 | `scripts/install-global.ts` 가 `.engineer-bot-managed` 마커만 보고 버전을 비교하지 않는다. 재설치가 조용한 다운그레이드가 될 수 있다 |
| P8 | `src/hook.ts:20` 의 승인 차단 정규식이 Bash 명령 문자열 전체를 훑으므로, **그 명령을 문서화하는 것조차 거부한다.** 2026-10-23 이 문서를 작성하다가 실측됨 |

---

## 2. 전제

- 컨트롤러는 Claude Code 세션 그 자체다. 훅·스킬 로딩·`Agent` 도구가 전부 Claude Code 기능이므로, 컨트롤러 교체는 워커 교체와 비용이 다르다.
- 사람 승인 게이트는 운영 절차이지 인증이 아니다. 파일시스템 접근 권한이 있는 사람은 우회할 수 있다 (`docs/OPERATIONS.md` 가 이미 명시).
- 컨트롤러는 코드를 쓰지 않는다. 훅이 `docs/development/**` 밖의 Write/Edit 를 거부한다. 코드는 전부 워커가 쓴다.
- 워커 디스패치는 이미 cwd 를 인자로 받는다. 워커는 컨트롤러가 어느 폴더에 있든 무관하다.
- 브랜치는 어느 트랙에서든 만든다. 메인에서 직접 작업하지 않는다.

---

## 3. 비목표

- **컨트롤러 호스트 중립화.** Gemini CLI 나 Codex 가 컨트롤러를 맡는 것은 훅·스킬·Agent 도구 의존을 전부 추상화해야 하므로 이번 범위 밖이다. 설정 스키마에 `controller.host` 자리만 남긴다.
- **태스크 단위 증거 보존.** 지금 `retry` 는 build 이후 모든 증거를 지운다. 태스크별 보존은 build 보고서를 phase 단위에서 task 단위로 쪼개야 하고 `complete build`·`validateBuildReviews`·원장 구조가 전부 따라 움직인다. 별도 작업이다. (§10)
- **아웃오브밴드 승인 채널.** Slack·푸시로 승인을 받는 경로는 봇과 엔드포인트가 필요하다. 설정 스위치(`approval.allowRelay`)만 남기고 채널 구현은 하지 않는다.
- **자동 머지·배포.** 기존 정책 그대로다. PR·push·merge·배포는 사용자가 그 행동을 명시적으로 요청해야 한다.

---

## 4. 결정 기록

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| D1 | 경량 트랙의 사람 게이트 | **계획 승인 + UAT 2개** | 시작 전 범위 확인과 결과 확인 둘 다 남긴다. full 의 절반 |
| D2 | 트랙 선택 주체 | **사람이 `init` 에서 명시. 에이전트는 승격 제안만** | 사람은 의도를 알고 에이전트는 실제 크기를 안다. 결정권은 사람 |
| D3 | 에이전트 설정 단위 | **implementer / reviewer / browserQa 3개. 컨트롤러는 호스트 고정** | 엔진을 분리하면 같은 모델의 맹점을 교차로 잡는다 |
| D4 | 리모트 승인 | **전달 모드 (`--relay`)** | 훅이 원래 보안 경계가 아니다. 지킬 값은 귀속이지 차단이 아니다 |
| D5 | 격리 방식 | **양 트랙 모두 worktree. 단 상태와 세션은 메인에 유지** | 컨트롤러는 코드를 안 쓰므로 이사 갈 이유가 없었다 |
| D6 | 의존성 설치 | **백그라운드 자동** | 체감 대기시간을 0에 가깝게. 첫 디스패치 전에 완료 확인 |
| D7 | 재시도 한도 | **태스크 단위 집계 · 기본 5 · `maxFixRounds` 설정에서 읽음** | AMENDMENTS A2 가 이미 동일 판단을 내렸다. 무한루프 방어선은 전체 상한으로 분리 |

---

## 5. 설계

### 5.1 트랙과 상태 머신

`State` 에 `track` 을 추가하고 전역 `phases` 배열을 트랙별로 분기한다.

```ts
export const TRACKS = {
  full:  ["brainstorm","product-gate","design","design-gate",
          "plan","plan-gate","worktree","build","review","browser-qa",
          "verification","uat-gate","finish","done"],
  light: ["brainstorm",
          "plan","plan-gate","worktree","build","review","browser-qa",
          "verification","uat-gate","finish","done"],
} as const;

export function phasesFor(s: State): readonly string[] {
  return TRACKS[s.track ?? "full"];
}
```

`complete`·`decide`·`retry` 가 전역 `phases` 대신 `phasesFor(s)` 를 본다. 인덱스 산술은 바뀌지 않는다.
`light` 는 `full` 의 부분집합이므로 단계 이름과 의미가 양쪽에서 동일하다.

`init` 이 트랙을 받는다.

```
development-harness init <slug> [--track full|light]    # 기본 full
```

**경량에서 설계가 필요한 경우** 별도 게이트를 만들지 않는다. `plan-bundle.json` 에 선택적 `design` 항목을
추가하고 계획 승인 한 번에 흡수한다. `workflow-contract.ts:bindApproval` 이 이미 `implementation` 과
`qaPlan` 을 해시로 묶으므로 같은 방식으로 `design` 을 묶는다. 게이트 수는 2개로 유지된다.

설계 필요 여부 판정은 brainstorm 산출물에 기록한다.

```json
{ "designNeeded": false, "reason": "기존 버튼 라벨 문자열 1곳 수정, 새 화면·상태 없음" }
```

사람은 계획 승인에서 이 판정과 결과를 함께 본다. `light` 인데 `designNeeded` 가 true 이면 계획 번들에
설계 문서가 반드시 있어야 하며, 없으면 `complete plan` 이 거부한다.

**승격**은 `plan-gate` 의 거부 경로를 재사용한다. 거부에 `--escalate '<이유>'` 를 붙이면
`track` 이 `full` 로 바뀌고 `phase` 가 `design` 으로 간다. 기존 거부 동작이 이미 하위 증거를 지우므로
새 전이 로직이 없다. `product-gate` 는 건너뛴다 — 승격 결정 자체가 사람이 `plan-gate` 에서 내린
결정이므로 기획 승인을 다시 받는 것은 중복이다. 대신 히스토리에 면제 사실을 기록한다.

```ts
{ phase:"plan-gate", action:"revise", escalatedTo:"full", waived:["product-gate"], reference:"<이유>", at:"..." }
```

에이전트는 brainstorm 이후 승격을 **제안**할 수 있다. 트랙을 바꾸는 경로는 위 사람 결정 하나뿐이다.
강등(full→light)은 제공하지 않는다 — 이미 통과한 게이트를 무효화할 이유가 없다.

### 5.2 격리 — 상태와 코드 분리

상태는 메인 체크아웃에 하나만 둔다. 코드와 커밋은 worktree 에서 일어난다. 컨트롤러 세션은 메인에 남는다.

```
메인 체크아웃                         worktree
─────────────                        ────────
.harness/state.json          ●        ○ 없음
.harness/repository-ledger   ●        ○ 없음
Claude 세션                  ●        ○
docs/development/<slug>/     ●        (커밋 시 worktree 브랜치로 이동)
소스 코드                             ●  워커가 여기서 작업
git 커밋                              ●  컨트롤러가 여기에
```

| 대상 | 지금 | 바뀐 뒤 |
|---|---|---|
| `store.ts:load()` | `s.root!==root` → throw | 상태는 메인에만. worktree 에 상태 파일을 만들지 않는다 |
| `cli.ts:60` | `s.worktree!==root` → throw | `s.worktree` 가 설정됐고 유효한 linked worktree 인지 단언 |
| `cli.ts:82-89` `worktree` 명령 | 상태 복사 후 원본을 `transferred` 로 | `s.worktree` 기록만. 원본이 계속 유일한 주인. `transferred` 상태 제거 |
| `cli.ts:19,20,62,70` | `evidence(root)` · `fingerprint(root)` | `s.worktree` 대상 |
| `cli.ts:37,38` | `repositoryGate(root,…)` | `repositoryGate(stateRoot, codeRoot, …)` — 원장은 메인, git 조작은 worktree |
| `cli.ts:72` | `git(root,"status","--porcelain")` | worktree 대상 |
| `evidence.ts` | `spawnSync(argv,{cwd:root})` | `cwd: s.worktree` |
| `hook.ts:11-12` | `within(root, actual)` | `root` 또는 `s.worktree` 안쪽 허용 |

세션은 `cd` + 재실행 대신 현재 세션에 폴더를 편입한다 — 터미널 Claude Code 는 `/add-dir`,
데스크톱 앱은 자체 디렉터리 추가. `worktree` 명령이 성공하면 그 안내 문구를 출력한다.

**새로 필요한 단언.** 지금은 컨트롤러가 worktree 안에 갇혀 있어서 "메인을 건드릴 수 없음" 이 암묵적으로
보장된다. 분리하면 그 보장이 사라지므로 `repositoryCommit` 이 명시적으로 검사해야 한다.

- 조작 대상 디렉터리가 `s.worktree` 와 동일한 realpath 인가
- 그 디렉터리의 현재 브랜치가 `worktree` 명령이 만든 브랜치인가
- 메인 체크아웃의 HEAD 가 이 커밋으로 움직이지 않았는가

셋 중 하나라도 어긋나면 커밋하지 않고 중단한다.

**의존성 설치.** `worktree` 명령이 폴더를 만든 직후 설치와 기준검사를 백그라운드로 시작하고
`.harness/worktree-prepare.log` 에 기록한다. 첫 구현 디스패치 전에 `dispatch` 명령이 완료와 성공을
확인한다. 실패하면 디스패치하지 않고 로그 경로와 함께 중단한다.

### 5.3 에이전트 플러거블화

#### 설정 2층

엔진 선택은 사람별 성격이고 검증 명령·정책은 프로젝트별이다.

```
~/.claude/harness/agents.json     사람 층 — 내가 쓰는 엔진 (기본값)
<project>/harness.config.json     프로젝트 층 — 검증 명령·정책. agents 를 덮어쓸 수 있다
```

병합 규칙: 프로젝트 층의 `agents.<role>` 이 있으면 그것을 쓰고, 없으면 사람 층을 쓴다. 역할 단위로 병합하며
부분 병합은 하지 않는다 — 한 역할의 설정은 통째로 한쪽에서 온다.

```json
// ~/.claude/harness/agents.json
{
  "version": 1,
  "agents": {
    "implementer": {
      "engine": "codex",
      "dispatch": { "kind": "claude-agent", "agent": "codex:codex-rescue",
                    "args": ["--wait","--fresh","--write"] },
      "instructions": "agents/codex/implementer.md"
    },
    "reviewer": {
      "engine": "claude",
      "dispatch": { "kind": "claude-agent", "agent": "general-purpose", "readOnly": true },
      "instructions": "agents/claude/reviewer.md"
    },
    "browserQa": {
      "engine": "codex",
      "dispatch": { "kind": "claude-agent", "agent": "codex:codex-rescue",
                    "args": ["--wait","--fresh"] },
      "instructions": "agents/codex/browser-qa.md"
    }
  }
}
```

Claude Code 플러그인 에이전트가 없는 엔진은 셸로 간다. 훅은 승인 명령 외의 Bash 를 막지 않는다.

```json
"implementer": {
  "engine": "gemini",
  "dispatch": { "kind": "shell", "command": ["gemini","-y","-p","{{prompt}}"] },
  "instructions": "agents/gemini/implementer.md"
}
```

#### `dispatch` 명령 — 엔진 지식을 산문에서 코드로

지금 "Codex 를 이렇게 불러라" 는 산문에 있다 (SKILL.md 12회, WORKFLOW.md 11회, OPERATIONS.md 22회).
엔진을 설정 가능하게 만들면서 산문을 그대로 두면 엔진마다 문서를 늘려야 한다.

```
development-harness dispatch <role> [<task-id>]
```

출력:

```json
{
  "role": "implementer",
  "engine": "codex",
  "invocation": { "kind": "claude-agent", "agent": "codex:codex-rescue",
                  "args": ["--wait","--fresh","--write"] },
  "cwd": "/abs/path/to/worktree",
  "instructions": "/abs/path/agents/codex/implementer.md",
  "scope": { "task": "T3", "allowed_files": ["src/foo.ts","src/foo.test.ts"] },
  "planExcerpt": "...",
  "reportPath": ".harness/worker-T3.json"
}
```

컨트롤러는 엔진을 알 필요 없이 출력대로 실행한다. SKILL.md 에서 Codex 고유 문장이 빠지고
"`dispatch` 결과대로 보내라" 로 줄어든다. `scope` 는 기존 Controller 소유 범위 규칙 그대로이며
워커가 넓힐 수 없다.

#### 지시 번들

Codex 는 Claude 스킬을 자동으로 읽지 않는다 (`docs/REPOSITORY-CONTROL.md` 명시). 엔진마다 다르므로
역할×엔진 지시를 하네스가 들고 간다.

```
agents/codex/implementer.md      agents/claude/reviewer.md
agents/codex/browser-qa.md       agents/gemini/implementer.md
```

엔진에 자체 스킬 설치 위치가 있으면 거기로 설치하고(지금 `~/.codex/skills/` 처럼), 없으면 프롬프트에
인라인으로 싣는다. 공통 규칙(`READY_FOR_COMMIT` 계약, 커밋 금지, RED/GREEN 증거)은 한 파일에 두고
엔진별 파일이 참조한다 — 같은 규칙을 엔진 수만큼 복제하지 않는다.

#### 계약 검증 변경

| 파일 | 지금 | 바뀐 뒤 |
|---|---|---|
| `cli.ts:64` | `t.executor!=="codex"` | `t.executor!==cfg.agents.implementer.engine` |
| `workflow-contract.ts:45` | `r.executor!=="codex"` | 역할별 설정 엔진과 대조 |
| `repository-control.ts:8,20` | `"codex"\|"claude"` | 설정된 엔진 집합 |
| `doctor.ts:12,15,16` | codex 플러그인·실행파일 하드코딩 | 설정된 역할의 엔진만 검사 |
| `hook.ts:12` | 거부 메시지에 "Codex" 고정 | 설정된 구현자 이름 |

독립성 규칙은 유지한다 — `freshSession===true` 이고 구현 디스패치와 겹치지 않을 것. 엔진이 같아도
통과한다(현재 동작). 다르면 교차검증 효과가 붙는다. `requireCrossEngineReview: true` 로 강제할 수 있게
하되 기본은 `false` 다.

### 5.4 리모트 승인

승인 명령에 전달 플래그를 추가한다.

```
development-harness decide approve --relay '<사용자 발화 원문>' '<근거: 대화 위치>'
```

히스토리 항목에 `actor` 를 추가한다.

```ts
history: [{ phase, action, reference, at,
            actor: "operator" | "relay",
            relayQuote?: string }]
```

훅은 귀속 없는 승인만 막는다. 현재 `hook.ts:20` 의 정규식에 `--relay` 예외를 추가한다.

CLI 가 강제하는 것:

- `--relay` 는 비어 있지 않은 인용을 요구한다. 공백만 있으면 거부
- 인용은 변형 없이 그대로 저장한다
- 승인 시점의 산출물 해시는 기존 `checkApprovals` 로 이미 고정된다
- `status` 와 최종 검증 보고가 전달 승인 게이트 수를 전면에 표기한다
- `harness.config.json` 의 `approval.allowRelay` 가 `false` 면 CLI 가 전달 승인을 거부한다 (기본 `true`)

**이것은 인증이 아니다.** 컨트롤러가 플래그를 임의로 붙일 수 있고, 기존 훅도 셸 변수로 우회된다.
바뀌는 것은 기록의 질이다 — 전달 승인과 직접 승인이 히스토리에서 구별되고, 최종 보고에 드러나고,
조직이 끌 수 있다. 이 한계를 `docs/OPERATIONS.md` 승인 범위 절에 명시한다.

**P8 도 여기서 고친다.** 현재 정규식은 Bash 명령 문자열 전체를 훑으므로 명령을 언급하는 문서 작성까지
거부한다. 판정을 **명령의 첫 토큰이 하네스 실행 파일이고 두 번째 토큰이 승인 명령일 때**로 좁힌다.
heredoc·리다이렉션·인용 안의 문자열은 판정 대상이 아니다.

### 5.5 재시도 한도

```
development-harness retry <findings> --task <task-id>
```

| # | 지금 | 바뀐 뒤 |
|---|---|---|
| 1 | `s.history.filter(h=>h.action==="retry").length>=3` | 해당 `task` 의 retry 만 집계 |
| 2 | `3` 하드코딩 | `harness.config.json` 의 `maxFixRounds` 를 읽는다. 기본 **5** |
| 3 | 전체 상한 없음 | `maxTotalFixRounds` 기본 **15**. 무한루프 방어선을 분리해 유지 |
| 4 | `uat-gate` 의 거부는 집계되지 않음 | **그대로 둔다.** 사람 판단이 기계 예산을 먹지 않는다. 대신 `status` 와 최종 보고에 횟수를 노출 |

`maxFixRounds` 는 이미 `harness.config.json` 에 있으나 아무도 읽지 않는 죽은 설정이다. 이번에 실제로 읽는다.
기본값 5 는 `AMENDMENTS.md` A2 의 판단과 일치한다 — 3회는 무한루프 방지가 목적인데 그 목적은 전체 상한이
충족하고, 5라운드는 모델 에스컬레이션이라는 회복 경로를 남긴다.

`--task` 가 없으면 거부한다. 어느 태스크의 재시도인지 모르면 태스크 단위 집계가 성립하지 않는다.

### 5.6 배포

| # | 처치 |
|---|---|
| P6 | `harness/controller-managed-git` 을 GitHub 기본 브랜치로 승격한다. README·OPERATIONS 의 clone 절차를 그 브랜치로 고친다. `claude-only` 는 보존하되 README 에 "구버전" 으로 명시한다 |
| P7 | 설치 번들에 `version` 을 심는다. `install-global.ts` 가 기존 설치본의 `version` 과 비교해 다운그레이드면 `--force` 없이 거부한다 |

`mode` 키는 이름을 바꾸지 않는다. `global-hook.ts` 가 `config.mode==="claude-only"` 일 때만 발동하고
`project.ts:setup()` 이 다른 값을 거부하므로, 이름을 바꾸면 기존 설치가 전부 깨진다. 새 철자 `"harness"` 를
추가하고 훅과 `setup` 이 두 값을 모두 받는다. `"claude-only"` 는 레거시 철자로 문서에 남긴다.

`setup` 이 사람 층 설정이 없으면 생성한다.

```
development-harness setup [--agents implementer=codex,reviewer=claude,browserQa=codex]
```

---

## 6. 수용 기준

1. `init --track light` 로 시작한 실행이 `product-gate`·`design`·`design-gate` 를 거치지 않고 `plan` 으로 간다.
2. `light` 실행의 `plan-gate` 거부가 `plan` 으로, `full` 실행의 `plan-gate` 거부가 `design-gate` 로 간다.
3. 승격 플래그를 붙인 거부가 `track` 을 `full` 로 바꾸고 `phase` 를 `design` 으로 보내며 면제를 기록한다.
4. `light` 이면서 `designNeeded:true` 인데 계획 번들에 설계 문서가 없으면 `complete plan` 이 거부한다.
5. `worktree` 명령 후 메인 체크아웃의 상태가 살아 있고 `phase` 가 `transferred` 가 아니다.
6. 메인 체크아웃에서 실행한 `repository-commit` 이 worktree 브랜치에 커밋하고, **메인 브랜치의 HEAD 를 움직이지 않는다.**
7. `s.worktree` 가 아닌 디렉터리를 대상으로 한 `repository-commit` 은 커밋 없이 중단한다.
8. `implementer.engine` 을 `gemini` 로 설정하면 `executor:"gemini"` 인 build 보고서가 통과하고 `executor:"codex"` 는 거부된다.
9. `doctor` 가 설정되지 않은 엔진의 실행파일·플러그인을 요구하지 않는다.
10. `dispatch implementer T1` 이 설정에 따라 서로 다른 invocation 을 출력한다.
11. 전달 승인이 `actor:"relay"` 와 인용을 히스토리에 남긴다.
12. 귀속 없는 승인 명령 실행을 훅이 계속 거부한다.
13. `approval.allowRelay:false` 이면 CLI 가 전달 승인을 거부한다.
14. **승인 명령 문자열을 본문에 포함한 파일 쓰기를 훅이 거부하지 않는다** (P8).
15. `retry --task T1` 을 5회 하면 T1 은 막히지만 T2 는 여전히 재시도할 수 있다.
16. `maxFixRounds:2` 로 설정하면 3회차에서 막힌다.
17. 전체 재시도가 `maxTotalFixRounds` 를 넘으면 태스크 잔여 예산과 무관하게 막힌다.
18. `install-global.ts` 가 더 낮은 `version` 설치를 `--force` 없이 거부한다.
19. `track` 이 없는 기존 상태 파일이 `full` 로 동작한다.

---

## 7. 구현 순서

| 단계 | 내용 | 근거 |
|---|---|---|
| 1. 척추 | 5.1 트랙 · 5.2 격리 · 5.5 재시도 | `phases` 와 `store` 를 건드린다. 나머지가 그 위에 얹히므로 먼저 하지 않으면 재작업이 된다 |
| 2. 노브 | 5.3 에이전트 설정과 `dispatch` · 5.4 리모트 | 계약 검증과 훅. 1단계와 파일은 겹치나 로직은 독립 |
| 3. 배포 | 5.6 · 문서 전면 갱신 | 1·2 가 끝나야 문서를 한 번만 고친다 |

---

## 8. 테스트

기존 `bun run check` (타입 + `src` 테스트) 와 `bun run smoke` 에 다음을 더한다.

| 영역 | 증명할 것 | 수용 기준 |
|---|---|---|
| 트랙 | light 가 설계 구간을 건너뛴다 · 트랙별 거부 목적지 | 1, 2 |
| 승격 | 전이와 면제 기록 | 3 |
| 경량 설계 | 번들 흡수와 누락 거부 | 4 |
| **상태/코드 분리** | **메인 브랜치를 건드리지 않는다** · 잘못된 대상 거부 | 5, 6, 7 |
| 엔진 교체 | 계약 검증과 doctor 가 설정을 따른다 · dispatch 출력 | 8, 9, 10 |
| 리모트 | actor 기록 · 훅 유지 · 스위치 · 오탐 제거 | 11, 12, 13, 14 |
| 재시도 | 태스크 단위 집계 · 설정 반영 · 전체 상한 | 15, 16, 17 |
| 배포 | 다운그레이드 거부 · 구버전 상태 호환 | 18, 19 |

굵게 표시한 것이 가장 중요하다. 컨트롤러를 메인에 남기면서 생기는 새 위험이며, 지금은 구조상 공짜로
막히던 것이다.

---

## 9. 마이그레이션

- `track` 이 없는 상태는 `full` 로 간주한다.
- 상태가 worktree 안에 있는 기존 배치(`s.root === s.worktree`)는 구버전으로 인식하고 그대로 완주시킨다.
  새 분리 방식은 신규 실행부터 적용한다. `workflowVersion` 이 없을 때 구버전 절차를 따르는 기존 패턴과 같다.
- `harness.config.json` 에 `agents` 가 없으면 사람 층을 보고, 그것도 없으면 현재 동작(전 역할 codex)을
  기본값으로 쓴다. 설정하지 않은 사용자의 동작이 바뀌지 않는다.
- `mode:"claude-only"` 는 계속 유효하다.

---

## 10. 위험과 남은 숙제

| 항목 | 내용 |
|---|---|
| 암묵적 보장의 소실 | 이 설계는 세 곳에서 암묵적 보장을 명시적 검사로 바꾼다 — 컨트롤러 격리, 엔진 고정, 승인 차단. 유연해지는 대신 검사를 코드로 내려야 하며, 검사가 빠지면 보장도 없다. §8 이 그래서 커졌다 |
| 태스크 단위 증거 보존 | `retry` 가 여전히 build 이후 모든 증거를 지운다. 한도를 5로 늘리고 태스크별로 세는 것으로 실용적 완화는 되지만 근본 해결은 아니다. 별도 작업으로 남긴다 |
| 전달 승인의 한계 | 인증이 아니다. 조직이 끄는 스위치와 보고서 표기가 유일한 통제다 |
| 셸 디스패치 엔진 | `kind:"shell"` 엔진은 Claude Code 의 도구 권한 밖에서 돈다. 워커 범위 규칙은 지시 번들과 `scope` 로만 전달되며 하네스가 강제하지 않는다. 기존 Codex 하위 프로세스도 같은 성질이다 (`docs/OPERATIONS.md`) |
| 브랜치 승격 | P6 는 GitHub 설정 변경이 필요하며 코드 작업이 아니다. 사람이 수행한다 |
| 훅 정규식 축소의 위험 | P8 수정은 판정 범위를 좁히는 것이므로, 좁히다가 실제 실행 경로를 놓치면 차단이 뚫린다. 수용 기준 12 와 14 를 **함께** 지키는 테스트가 필요하다 |

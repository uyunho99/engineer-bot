# Orca 오케스트레이션 개발 하네스 쿡북

> **사용 환경:** Orca 안의 Claude 터미널 · `orca-orchestration` 브랜치
>
> **진행 담당:** Main Claude + Orca · **워커:** Claude / Codex
>
> **기본 완료 동작:** 브랜치 유지. 두 하네스 브랜치를 merge하지 않습니다.

## 목차

- [빠른 시작](#빠른-시작)
- [전체 흐름과 역할](#전체-흐름과-역할)
- [단계별 실행](#단계별-실행)
- [워커 메시지 확인](#워커-메시지-확인)
- [보고서 작성](#보고서-작성)
- [문제 해결과 상태 복구](#문제-해결과-상태-복구)
- [검증과 재사용](#검증과-재사용)
- [설치 버전과 적용 범위](#설치-버전과-적용-범위)

## 빠른 시작

이 체크아웃을 Orca에 등록하고 엽니다.
CLI가 실제 코디네이터의 터미널 식별자를 찾을 수 있도록, 해당 체크아웃의 Claude 터미널에서 코디네이터 명령을 실행하세요.
관계없는 터미널에서 `--from`을 지정해 코디네이터를 가장하면 안 됩니다.

**기존 실행이 있으면 아래의 `init`을 생략하고 `status`로 재개 지점을 확인하세요.**

```bash
bun install --frozen-lockfile
bun run harness doctor
bun run harness init invite-team
bun run harness orca-sync
bun run harness status
```

**시작 전 확인**

- [ ] `orca-orchestration` 체크아웃을 Orca에서 열었습니다.
- [ ] 해당 체크아웃의 Claude 터미널에서 실행합니다.
- [ ] `doctor`가 설치 가이드와 런타임을 확인했습니다.
- [ ] 기존 실행이 있다면 새로 만들지 않고 `status`로 확인합니다.

> **설치 버전 주의:** 현재 지원 경로는 `task-create → dispatch → check`입니다. `run-create`·`worker-start`는 없습니다. 자세한 차이는 [설치 버전과 적용 범위](#설치-버전과-적용-범위)를 참고하세요.

## 전체 흐름과 역할

```text
기획 → [제품 승인] → 설계 → [설계 승인] → 구현 계획 + QA 계획
     → [계획 승인] → worktree → TDD 구현 → READY_FOR_COMMIT → Controller gate/commit → 독립 리뷰 → 브라우저 QA
     → 최종 검증 → [UAT 승인] → 브랜치 유지

실패·UAT 수정 요청 → TDD 구현 → 리뷰 → QA → 검증 반복
```

| 담당 | 하는 일 | 사용하는 수단 |
|---|---|---|
| 사용자 | 제품·설계·계획·UAT 검토와 승인 | 자신의 터미널에서 `harness decide` |
| Main Claude | 기획, 배정, 진행 확인, 근거 검토 | 하네스 CLI와 설치된 스킬 |
| Orca | Task·Dispatch·Gate 기록과 실행 추적 | 설치 버전에 맞는 실행 규약 |
| Claude / Codex 워커 | 명세에 배정된 구현·리뷰·QA | 주입된 Task와 완료 메시지 |

**읽는 방법:** 단계별 산출물과 워커 결과를 확인한 뒤 다음 명령을 실행합니다. 전체를 한 번에 붙여 넣지 마세요.

## 단계별 실행

### 1. 기획·설계·계획 승인

| 단계 | 문서 | 승인 전 확인 |
|---|---|---|
| 기획 | `01-brainstorm.md` | 문제, 범위, 수용 기준 |
| 설계 | `02-design.md` | 구조와 사용자 흐름 |
| 구현·QA 계획 | `03-plan.md` | 작업 순서, 소유 경로, 테스트 기준 |

Main Claude는 설치된 Superpowers의 brainstorming 지침을 적용해
`docs/development/invite-team/01-brainstorm.md`를 작성합니다. 작성 후 다음 명령으로 기획 단계를 완료합니다.

```bash
bun run harness complete brainstorm docs/development/invite-team/01-brainstorm.md
```

실행은 `product-gate`에서 멈추고 실제 Orca 게이트가 생성됩니다.
사용자가 산출물을 검토한 뒤 자신의 터미널에서 승인합니다. 에이전트가 승인을 만들어 기록하면 안 됩니다.

```bash
bun run harness decide approve '대화 12번 메시지에서 제품 기획 승인'
# 수정 요청은 revise, 취소는 cancel입니다. 각각 실제 결정 근거를 함께 적습니다.
```

설계 문서 `02-design.md`와 계획 문서 `03-plan.md`에서도 같은 절차를 반복합니다.
`03-plan.md`에는 구현 계획과 QA 계획을 함께 담아 하나의 해시로 승인 대상을 고정합니다.
설치된 gstack의 `plan-design-review`와 `plan-eng-review`를 사용하되,
접두사가 붙은 별칭이 있다고 가정하지 말고 로컬 스킬의 frontmatter에 적힌 이름을 확인하세요.
모든 승인은 명시적으로 받으며, 승인된 문서가 바뀌면 수정 승인이나 재계획이 필요합니다.

### 2. 승인된 계획으로 worktree 생성

계획 승인 후에는 산출물을 커밋하고 worktree를 만듭니다.
`/absolute/feature/checkout`은 새 체크아웃의 실제 절대 경로로 바꾸세요.

```bash
# Controller: status/diff/scope를 검토한 정확한 파일만 stage합니다.
git status --short
git diff --check
git diff
git add -- docs/development/invite-team/01-brainstorm.md docs/development/invite-team/02-design.md docs/development/invite-team/03-plan.md
git commit -m 'docs: 구현과 QA 계획 승인'
bun run harness worktree /absolute/feature/checkout feature/invite-team
cd /absolute/feature/checkout
bun install --frozen-lockfile
```

새 worktree를 Orca에서 열고 그 안의 Claude 코디네이터로 작업을 이어갑니다.
상태는 새 체크아웃에 복사되고 원래 체크아웃은 `transferred` 상태가 됩니다.
실행을 묶는 최상위 Task 컨테이너는 그대로 유지됩니다.

`--no-parent`는 Orca 사이드바의 부모·자식 관계를 결정하는 옵션이며 Git 기준 커밋을 선택하는 옵션은 아닙니다.
하네스의 worktree 명령은 승인된 기획 자료가 포함된 현재 커밋을 기준으로 사용합니다.
승인 전에는 워커를 만들지 않습니다.

### 3. 작업별 구현과 독립 리뷰

**워커 명세 준비**

- [ ] 계획상의 Task ID와 수정할 경로
- [ ] 수용 기준과 테스트 실패·통과 확인 명령
- [ ] 다른 워커의 변경을 되돌리지 않는다는 규칙
- [ ] 결과 보고서 경로

위 항목을 `docs/development` 아래의 작업 명세에 작성한 뒤 실행합니다.

```bash
bun run harness orca-start docs/development/invite-team/T1.md codex T1
bun run harness orca-check T1
# 완료가 인정될 때까지 확인을 이어갑니다. 질문이 도착하면 바로 내용을 검토합니다.
# 구현 보고서 READY_FOR_COMMIT을 확인한 Controller만 실행합니다.
bun run harness repository-gate .harness/T1-report.json .harness/T1-scope.json
# 출력 diff와 untracked 내용을 검토하고 실제 token을 전달합니다.
bun run harness repository-commit <gate-token>
# 리뷰 명세에 반환된 base_commit과 commit.sha를 고정합니다.
bun run harness orca-start docs/development/invite-team/review-T1.md claude review-T1
bun run harness orca-check review-T1
```

`orca-start`를 실행하면 하위 Task와 해당 체크아웃의 새 에이전트 터미널을 만듭니다.
터미널 인터페이스가 준비될 때까지 기다린 뒤 실행 규약을 포함한 작업을 주입해 배정하고, 실제 dispatch 식별자를 저장합니다.
`build` 단계에서 키가 `review-`로 시작하는 작업에는 소스 읽기 전용 권한을 부여합니다.

기본 실행 방식은 순차 처리입니다. 아직 완료를 인정하지 않은 작업이 있으면 다음 작업을 시작하지 않습니다.
워커마다 별도 worktree를 추가로 만들지 않습니다. 후속 작업에는 `T2`, `review-T2`처럼 고유한 키를 사용하세요.

### 4. 구현 결과 취합

> 다음 명령에서 지정하는 보고서는 실제 실행 근거로 작성해야 합니다. 형식은 [보고서 작성](#보고서-작성)을 참고하세요.

모든 구현 Task와 개별 리뷰가 끝나면 결과를 모은 보고서로 `build`를 완료합니다.
이후 각 단계에서 독립 워커를 `orca-start`로 배정하고 `orca-check`로 확인한 다음 `complete`를 실행합니다.

```bash
bun run harness complete build docs/development/invite-team/build.json
```

### 5. 전체 변경 리뷰

```bash
bun run harness orca-start docs/development/invite-team/whole-review.md claude
bun run harness orca-check
bun run harness complete review docs/development/invite-team/review.json
```

### 6. 브라우저 QA

```bash
bun run harness orca-start docs/development/invite-team/browser-qa.md claude
bun run harness orca-check
bun run harness complete browser-qa docs/development/invite-team/qa.json
```

### 7. 최종 검증

```bash
bun run harness orca-start docs/development/invite-team/verify.md claude
bun run harness orca-check
bun run harness complete verification docs/development/invite-team/verification.json
```

### 8. 사용자 UAT 승인

```bash
# 사용자가 변경 내용, QA 결과, 검증 근거를 검토한 뒤 승인합니다.
bun run harness decide approve '최종 UAT 승인, 브랜치 유지'
```

### 9. 브랜치 마무리

```bash
# 승인된 소스와 근거 자료를 커밋한 뒤 완료합니다.
bun run harness complete finish docs/development/invite-team/verification.json
```

## 워커 메시지 확인

| 확인한 상태 | 의미 | 다음 행동 |
|---|---|---|
| 최대 30초 대기 종료 | 아직 완료를 확인하지 못함 | 워커를 종료하지 말고 확인 계속 |
| `heartbeat` | 워커가 활동 중임 | 완료 메시지 대기 |
| `ask` 질문 | 코디네이터의 답이 필요함 | 해당 메시지에 `reply` |
| Task가 `completed` | 실행 시도가 끝남 | 판정과 근거까지 확인 |
| 일치하는 `worker_done` + 구조화된 `PASS` | 완료 판정의 필수 조건 충족 | 런타임 상태·보고서 검토 후 단계 완료 |
| 오래된 ID·다른 Task·본문의 `PASS` | 유효한 완료 근거가 아님 | 다음 단계로 진행하지 않음 |

`orca-check`가 읽은 메시지는 Git 추적에서 제외된 `.harness` 파일에 저장합니다.
단계를 완료할 때는 현재 dispatch와 Task 상태를 다시 확인합니다.

워커가 `ask`로 보낸 질문에는 코디네이터가 `orchestration reply --id <message-id> --body ...`로 답합니다.
제품·설계·계획·UAT에 대한 사용자 결정은 `harness decide`로 기록합니다.
이 명령은 해당 Orca 게이트를 해결하고 로컬 결정 이력을 남깁니다. 워커 질문에 대한 답변과 사용자 승인은 서로 다른 절차입니다.

워커가 실패했더라도 `worker_done`이 실행 시도의 종료를 알리면 런타임 상태는 `completed`일 수 있습니다.
따라서 완료 상태뿐 아니라 판정과 근거를 함께 확인해야 합니다.
진행 중인 모든 Task가 종료됐음을 확인한 뒤에만 재시도하세요. 워커를 직접 완료 처리하면 안 됩니다.
하네스는 완료·취소 시 담당 코디네이터 소유의 최상위 컨테이너를 정리할 때만 `task-update`를 사용합니다.

## Repository control

두 실행 경로의 공통 [Repository Control 정책](REPOSITORY-CONTROL.md)을 필수 적용합니다.
Task 구현/수정 완료와 리뷰 사이에는 반드시 Controller gate와 commit이 있습니다.
Worker 보고서와 aggregate build 보고서는 서로 다릅니다. 아래 aggregate 예제의 tasks에도
공통 정책의 ledger 필드와 review_commit/review_verdict를 추가해야 CLI가 수락합니다.
기존 보고서에 커밋이 없다면 실제 gate/commit/review를 수행해 재작성합니다.

## 보고서 작성

실행 보고서는 `docs/development/<feature>` 아래에 JSON으로 작성합니다.
아래 설명용 문자열은 실제 값과 근거로 바꾸세요.

```json
{
  "verdict": "PASS",
  "head": "실제 Git HEAD",
  "fingerprint": "src/store.ts로 계산한 실제 소스 지문",
  "commands": [
    {
      "command": "실제로 실행한 테스트 명령",
      "exitCode": 0
    }
  ],
  "findings": [],
  "tasks": [
    {
      "id": "T1",
      "executor": "codex",
      "committer": "controller",
      "repository_control": {"mode": "controller_managed"},
      "base_commit": "실제 부모 SHA",
      "commit": {"sha": "실제 Controller commit SHA", "message": "실제 커밋 메시지"},
      "review_commit": "리뷰한 동일 commit SHA",
      "review_verdict": "PASS",
      "red": "테스트 실패 로그",
      "green": "테스트 통과 로그",
      "review": "review-T1의 리뷰 근거"
    }
  ],
  "scenarios": [
    {
      "id": "QA1",
      "result": "PASS",
      "evidence": "실제 브라우저 출력 또는 스크린샷"
    }
  ]
}
```

소스 지문은 다음 명령으로 계산합니다.

```bash
bun -e 'import {fingerprint} from "./src/store.ts"; console.log(fingerprint(process.cwd()))'
```

`bun run evidence`는 저장소 검사와 빌드를 실행하고, 전체 명령 결과·HEAD·소스 지문이 포함된 `verification.json`을 작성합니다.
QA에는 실제 브라우저 시나리오를 기록해야 합니다. UI가 없는 작업이라면 `notApplicable`에 해당하지 않는 구체적인 이유를 적습니다.
이번 저장소 변경은 CLI에만 해당하므로 브라우저 테스트가 필요하지 않았습니다.
보고서는 로그와 사람의 검토로 뒷받침하는 기록이며, 작업 수행을 암호학적으로 증명하는 장치는 아닙니다.

## 문제 해결과 상태 복구

| 상황 | 다음 행동 |
|---|---|
| 리뷰 후 코드 변경·QA 실패 | `retry`로 구현부터 다시 진행 |
| UAT 수정 요청 | 구현 → 리뷰 → QA → 검증 반복 |
| 수정 시도 세 차례 실패 | 중단 후 계획 재검토 |
| 잠금이 남음 | 살아 있는 터미널·Task를 먼저 확인 |
| RPC 성공 여부가 불확실함 | Task·Gate·Dispatch를 대조하고 복구. 무조건 재실행하지 않음 |
| 단계 완료 후 게이트 생성 전에 종료 | `orca-sync`로 대기 게이트 생성 |
| 런타임·가이드가 바뀜 | 기존 기록과 명시적으로 대조한 뒤 재개 |

### 수정 후 다시 진행하기

리뷰 뒤 소스가 바뀌었다면 `harness retry 'reproduction and findings'`로 재현 방법과 발견 사항을 기록하고 구현 단계로 돌아갑니다.
TDD 수정, 독립 리뷰, 브라우저 QA, 최신 코드 검증을 다시 거쳐야 합니다. UAT에서 수정을 요청한 경우도 같습니다.
실패에 따른 수정 시도가 세 차례에 이르면 중단하고 계획을 다시 검토받습니다.
기본 완료 동작은 브랜치를 유지하는 것입니다. Merge·push·PR 생성·배포는 사용자가 해당 행동을 명시적으로 요청했을 때만 진행합니다.

### 상태 저장과 비정상 종료 복구

체크아웃 하나당 활성 실행은 하나만 허용합니다.
상태는 원자적으로 JSON을 저장하고 `.harness/lock`으로 동시 수정을 막습니다.
장기 보관할 산출물은 Git으로 추적하고, 런타임 ID와 메시지는 추적에서 제외합니다. 상태 파일을 직접 덮어쓰지 마세요.

비정상 종료 후에는 살아 있는 터미널, Task, `dispatch-show` 결과를 확인한 뒤 남은 잠금을 해제합니다.
RPC 호출은 성공했지만 ID 저장이 실패했다면, 실행 이름을 기준으로 `task-list`와 `gate-list`를 찾아 상태를 대조하고 복구해야 합니다.
외부 상태를 바꾸는 명령을 확인 없이 다시 실행하면 안 됩니다.
배정 직전에 배정 의도를 저장하므로, 응답이 불확실할 때는 자동 재시도 대신 복구 절차를 거칩니다.

단계 완료 직후 게이트 생성 전에 종료됐다면 `orca-sync`로 대기 중인 로컬 게이트를 만들 수 있습니다.
이미 해결된 게이트에는 동일한 결정을 다시 적용해도 중복으로 처리하지 않습니다.

시간 초과만을 이유로 Orca 전역 상태를 초기화하거나 워커를 종료·닫으면 안 됩니다.
터미널 식별자의 변화와 Task·Dispatch의 실행 권한을 혼동하지 마세요.
오래된 터미널 식별자는 터미널 목록에서 다시 찾고, 런타임이나 가이드가 바뀌었다면 상태를 명시적으로 대조해야 합니다.

## 검증과 재사용

- `bun run check`: 타입 검사와 테스트를 실행합니다.
- `bun run smoke`: 전체 단계 흐름을 검사합니다.
- `bun run build`: `dist/cli.js`를 생성합니다.

기존의 승인 없는 `plan --execute` 진입점은 제거했습니다.
다른 저장소에 적용하려면 `src` 실행 코드, 프로젝트 스킬, 설정 파일, package 스크립트를 복사합니다.
`CLAUDE.md`, `AGENTS.md`, hook에는 대상 저장소의 기존 정책을 보존하면서 필요한 내용을 추가하세요.
검증 명령은 해당 저장소에 문서화된 검사에 맞게 바꿉니다.
`SKILL.md`는 복사해서 사용할 수 있지만 함께 제공된 실행 코드에 의존합니다.

## 설치 버전과 적용 범위

### 지원 명령과 응답 형식

2026-09-05 기준으로 `/usr/local/bin/orca`는 설치된 Orca 앱을 가리킵니다.
`orca skills get orchestration`으로 해당 설치 버전에 맞는 전체 가이드를 확인했습니다.
가이드의 해시는 다음과 같습니다.

```text
0cfb6a082625edc0d474bae430eb22c28bbe484e54fbfebedb4ff89d96e36305
```

`orca orchestration --help`에는 `run`, `task-create`, `dispatch`, `dispatch-show`, `check`,
`ask/reply`, `gate-create/gate-resolve`가 있습니다. **`run-create`와 `worker-start`는 없습니다.**
이 CLI의 `--version`으로는 유효한 버전 정보를 얻을 수 없어, 실행마다 가이드 해시를 기록하고 비교합니다.
설치된 앱의 구현에서도 dispatch의 `id`·`task_id`·`status`, `terminal.create`의 `result.terminal`,
JSON 문자열로 저장되는 메시지 payload 형식을 확인했습니다.

### 실행 파일 선택 순서

실행 파일은 다음 우선순위로 선택합니다.

1. `ORCA_CLI_COMMAND`가 설정돼 있으면 그 값을 사용합니다.
2. 그렇지 않고 `ORCA_DEV_REPO_ROOT`가 설정된 개발 환경이면 `orca-dev`를 사용합니다.
3. 그 외 Linux 환경에서는 `orca-ide`를 사용합니다.
4. 나머지 환경에서는 `orca`를 사용합니다.

선택한 실행 파일이 실패해도 다른 설치본으로 자동 전환하지 않습니다.
`doctor`는 가이드와 도움말을 읽고 런타임에 접근할 수 있는지 확인합니다.
실행 중 가이드나 런타임이 바뀌면 상태를 대조하고 복구할 때까지 중단해 중복 배정을 방지합니다.

### 최상위 Task와 Run의 차이

이 하네스는 **최상위 Task를 실행 컨테이너로 사용**합니다.
그 아래에 구현·리뷰·QA Task를 만들고, 컨테이너에 실제 Orca 승인 게이트를 연결합니다.
Orca의 네이티브 Run 레코드를 만드는 구조는 아닙니다.
설치 버전의 `run`은 자체 자동 코디네이터를 실행하므로 함께 사용하면 스케줄러가 둘이 됩니다.
따라서 이 하네스는 공식 가이드의 수동 배정 루프를 사용합니다.
향후 Run·worker-start를 지원하는 버전으로 전환할 때는 명령 이름만 치환하지 말고, 해당 설치 버전의 가이드를 기준으로 어댑터를 수정해야 합니다.

### 함께 확인한 의존성

함께 확인한 의존성은 Bun 1.3.14, Claude Code 2.1.261, 안정 버전 Superpowers 6.2.0,
gstack 1.6.1.0의 커밋 `656df0e`입니다. gstack 스킬은 접두사 없이 설치돼 있습니다.
전역 설치는 변경하지 않았습니다. 이 브랜치는 추적 대상 작업에서 codex-plugin-cc를 사용하지 않도록
프로젝트 설정의 `codex@openai-codex`를 비활성화합니다.

### 검증 범위와 권한

테스트는 모델을 자동으로 호출하지 않습니다. 실제 런타임에서 실행한 것은 Task·Gate 메타데이터 smoke 검사이며,
유료 모델 워커의 전체 실행을 검증한 것은 아닙니다.

Hook은 네이티브 하위 에이전트 생성, `build` 단계 밖에서 구조화된 편집 도구로 소스를 수정하는 행동,
에이전트가 사람 승인을 기록하는 행동을 차단합니다.
셸과 플러그인 하위 프로세스에는 기존 사용자 권한이 적용되며 작업 범위를 따라야 합니다.
소스 지문은 리뷰 이후 코드 변경을 검사합니다. 이는 운영 규약을 보조하는 장치이며 OS 보안 경계는 아닙니다.
Codex 하위 프로세스는 `AGENTS.md`와 Task의 권한을 따르고 Claude hook을 상속하지 않습니다.
승인 근거는 실제 사용자 결정에서 가져와야 합니다. 파일시스템이나 CLI에 직접 접근하면 로컬 절차를 우회할 수 있습니다.

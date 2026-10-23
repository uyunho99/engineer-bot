# 개발 하네스 쿡북

> **컨트롤러:** Claude Code · Codex · Gemini CLI 중 하나 · **워커:** 역할별로 설정한 엔진
>
> **사용자 승인:** full 트랙 제품 / 설계 / 계획 / UAT · light 트랙 계획 / UAT
>
> **기본 완료 동작:** 브랜치 유지. merge·push·PR·배포는 사용자가 따로 요청합니다.

## 목차

- [설치](#설치)
- [엔진·호스트 설정](#엔진호스트-설정)
- [프로젝트 연결](#프로젝트-연결)
- [트랙 고르기](#트랙-고르기)
- [단계별 실행](#단계별-실행)
- [보고서 작성](#보고서-작성)
- [가드](#가드)
- [문제 해결과 상태 관리](#문제-해결과-상태-관리)
- [검증과 재사용](#검증과-재사용)
- [의존성과 적용 범위](#의존성과-적용-범위)

## 설치

하네스 원본 저장소에서 한 번 설치합니다. 자세한 clone 절차는 [README](../README.md)에 있습니다.

```bash
bun install --frozen-lockfile
bun run install:global --host claude-code    # codex, gemini도 가능. 여러 번 실행해 함께 설치할 수 있습니다
```

CLI·hook·역할 지시·문서는 `~/.local/share/development-harness/`에 하나만 설치되고, 호스트마다 컨트롤러 스킬만 따로 깔립니다.
이전 버전처럼 CLI가 `~/.claude/skills/development-harness-native/` 안에 있던 설치 위에 다시 설치하면, Claude Code hook의
경로를 새 위치로 옮기고 스킬 폴더의 묵은 CLI·문서 사본을 지웁니다.
설치기는 설치한 버전을 `VERSION`에 기록하고, 더 낮은 버전으로 덮어쓰려 하면 `--force` 없이는 거부합니다.

## 엔진·호스트 설정

설정은 두 층입니다. 역할 하나는 통째로 한 층에서 옵니다.

| 층 | 위치 | 용도 |
|---|---|---|
| 사람 | `~/.config/development-harness/agents.json` | 내 머신의 기본 엔진과 컨트롤러 호스트 |
| 프로젝트 | `harness.config.json` | 프로젝트가 강제하는 엔진·정책. 같은 역할이 있으면 사람 층을 덮어씁니다 |

```json
{
  "controller": { "host": "claude-code" },
  "agents": {
    "implementer": { "engine": "codex",  "dispatch": { "kind": "claude-agent", "agent": "codex:codex-rescue", "args": ["--wait", "--fresh", "--write"] } },
    "reviewer":    { "engine": "claude", "dispatch": { "kind": "claude-agent", "agent": "general-purpose", "readOnly": true } },
    "browserQa":   { "engine": "codex",  "dispatch": { "kind": "shell", "command": ["codex", "exec", "-s", "workspace-write", "-C", "{{cwd}}", "{{prompt}}"] } }
  },
  "requireCrossEngineReview": true
}
```

- `controller.host`: `claude-code`(기본), `codex`, `gemini`. Antigravity는 아직 받지 않습니다.
- `dispatch.kind`
  - `claude-agent`: Claude Code의 Agent 도구로 띄웁니다. **컨트롤러가 Claude Code일 때만** 쓸 수 있습니다.
  - `shell`: 프로세스로 띄웁니다. `{{prompt}}`(프롬프트 내용) 또는 `{{promptFile}}`(프롬프트 파일 경로) 중 하나가 반드시 들어가야 하고, `{{cwd}}`는 worktree 경로로 바뀝니다.
- 아무것도 설정하지 않았을 때의 기본값

  | 컨트롤러 | 구현 | 리뷰 | 브라우저 QA |
  |---|---|---|---|
  | claude-code | `codex:codex-rescue --wait --fresh --write` | `codex:codex-rescue --wait --fresh` (읽기 전용) | `codex:codex-rescue --wait --fresh` |
  | codex | `codex exec -s workspace-write -C {{cwd}}` | `codex exec -s read-only -C {{cwd}}` | `codex exec -s workspace-write -C {{cwd}}` |
  | gemini | `gemini -y -p {{prompt}}` | 같음 (읽기 전용 지시) | 같음 |

  codex 플래그는 codex-cli 0.153.4에서 확인했습니다. gemini 플래그는 Gemini CLI의 비대화 모드 문서를 따랐고 이 저장소를 만든 머신에서는 실행해 보지 못했습니다.
- `requireCrossEngineReview`: true면 리뷰어와 구현자가 같은 엔진일 때 설정을 거부합니다. 기본 false.
- `instructions`: 역할 지시 파일을 바꾸려면 경로를 적습니다. 상대 경로는 하네스 설치 위치 기준입니다. 없으면 `agents/<engine>/<역할>.md`, 그다음 `agents/common/<역할>.md`를 씁니다.

**계획을 완료하는 순간 엔진이 실행에 고정됩니다.** 다른 사람이 자기 머신에서 실행을 이어받아도 엔진이 바뀌지 않고, 기존 태스크 보고서가 그대로 유효합니다.

프로젝트 정책 항목:

| 항목 | 기본 | 뜻 |
|---|---|---|
| `maxFixRounds` | 5 | 태스크 하나당 수정 라운드 한도 |
| `maxTotalFixRounds` | 15 | 실행 전체 수정 라운드 한도 |
| `approval.allowRelay` | true | 대화에서 전달한 승인을 받을지 |
| `mode` | `harness` | 이 프로젝트에서 가드가 동작한다는 표시. 예전 철자 `claude-only`도 유효합니다 |

## 프로젝트 연결

개발할 프로젝트에서 컨트롤러를 실행하고 스킬을 부릅니다. 직접 연결할 때는:

```bash
cd /path/to/your-project
~/.local/bin/development-harness doctor
~/.local/bin/development-harness setup
~/.local/bin/development-harness configure '[["npm","test"],["npm","run","build"]]'
~/.local/bin/development-harness status
```

새 프로젝트라면 Git 저장소를 만들고 초기 커밋을 한 뒤 시작합니다. `setup`은 `harness.config.json`과 `.gitignore`의 `.harness/` 항목만 추가합니다.
검증 명령은 계획 완료 전에 설정해야 하고, 승인 후 설정을 바꾸면 진행이 막힙니다.

`doctor`는 선언된 컨트롤러 호스트의 스킬, 설정된 엔진이 실제로 쓰는 실행 파일과 플러그인만 확인합니다. 쓰지 않는 엔진은 요구하지 않습니다.
실행이 있으면 pre-commit과 감시자 상태도 보여 줍니다.

## 트랙 고르기

| | full | light |
|---|---|---|
| 언제 | 새 기능, 큰 변경, 새 화면 | 핫픽스, 작은 수정, 설정·문구 변경 |
| 단계 | 기획 → 설계 → 계획 → worktree → 배송 → UAT | 기획 → 계획 → worktree → 배송 → UAT |
| 승인 | 제품 · 설계 · 계획 · UAT | 계획 · UAT |
| 설계 | 별도 게이트 | 필요하면 계획 번들에 함께 넣어 계획과 한 번에 승인 |

트랙은 사람이 `init`에서 정합니다. light로 시작했는데 커지면 계획 승인에서 승격합니다. 강등은 없습니다.

```bash
~/.local/bin/development-harness init invite-team --track full
~/.local/bin/development-harness init fix-login-label --track light
```

## 단계별 실행

### 1. 기획

```bash
~/.local/bin/development-harness complete brainstorm docs/development/<slug>/01-brainstorm.md
```

full이면 제품 승인 게이트에서 멈춥니다. light는 게이트 없이 계획으로 갑니다.
light의 기획 문서에는 설계가 필요한지와 그 이유를 적습니다.

### 2. 승인 기록

```bash
# 사용자가 자신의 터미널에서
~/.local/bin/development-harness decide approve '대화 12번 메시지에서 제품 기획 승인'
~/.local/bin/development-harness decide revise '초대 범위 수정'
~/.local/bin/development-harness decide cancel '이 기능 개발 취소'

# 사용자가 대화에서 승인했을 때, 컨트롤러가 발화를 원문 그대로 인용해서
~/.local/bin/development-harness decide approve --relay '좋아, 이대로 진행해' '대화 12번 메시지'

# light 계획 승인 게이트에서 full로 올릴 때
~/.local/bin/development-harness decide revise --escalate '새 화면이 필요해 목업 없이는 판단 불가'
```

전달 승인은 히스토리에 `actor: relay`와 인용이 남고, `status`와 최종 검증 보고에 따로 표시됩니다.
승격하면 full의 설계 단계로 가고, 제품 승인은 승격 결정으로 면제됐다고 기록됩니다.

### 3. 설계·계획

| 승인 대상 | 작성할 파일 | 사용자 확인 사항 |
|---|---|---|
| 설계 (full) | `02-design.md` + 목업 + `design-bundle.json` | 실제 화면·흐름과 구조가 맞는가? |
| 계획 | `03-plan.md` + `QA_PLAN-<feature>.md` + `plan-bundle.json` | 구현 순서와 QA 기준이 모두 정해졌는가? |

light의 `plan-bundle.json`에는 `"designNeeded": true|false`가 반드시 있고, true면 `"design": "<설계 문서>"`도 있어야 합니다.

```bash
~/.local/bin/development-harness complete design docs/development/<slug>/design-bundle.json
~/.local/bin/development-harness complete plan docs/development/<slug>/plan-bundle.json
```

### 4. worktree

계획을 승인하면 기획 산출물을 커밋하고 worktree를 만듭니다.

```bash
git status --short
git diff --check
git add -- docs/development/<slug>/ harness.config.json .gitignore
git commit -m 'docs: 기능 계획 승인'
~/.local/bin/development-harness worktree /absolute/new/checkout feature/<slug>
```

**세션을 다시 시작하지 않습니다.** 실행 상태(`.harness/`)는 지금 체크아웃에 남고, 코드와 커밋은 worktree에서 일어납니다.
Claude Code라면 `/add-dir /absolute/new/checkout`으로 현재 세션에 worktree를 추가합니다.
이 명령은 의존성 설치(잠금 파일로 패키지 매니저를 고릅니다)와 감시자를 백그라운드로 시작하고 pre-commit을 설치합니다.

```bash
~/.local/bin/development-harness prepare-status    # running → ok 또는 failed. failed면 .harness/worktree-prepare.log
~/.local/bin/development-harness prepare           # 다시 시작
```

### 5. 구현 위임

```bash
~/.local/bin/development-harness dispatch implementer T1 --files src/invite.ts,src/invite.test.ts
```

출력의 `invocation`대로 워커를 띄웁니다. `claude-agent`면 Agent 도구로, `shell`이면 `cwd`에서 명령을 그대로 실행합니다.
`promptFile`에는 워커 계약, 역할 지시, 승인된 계획의 해당 태스크 절, 보고서 경로, 보고할 `executor` 값이 들어 있습니다.
의존성 준비가 끝나지 않았거나 실패했으면 디스패치가 거부됩니다.

워커가 `READY_FOR_COMMIT`을 반환하면 Controller가 커밋합니다.

```bash
~/.local/bin/development-harness repository-gate .harness/worker-T1.json .harness/scope.json
~/.local/bin/development-harness repository-commit <token>
```

커밋하면 그 태스크의 범위가 소진됩니다. 수정 라운드는 다시 `--files`로 디스패치합니다.

### 6. 리뷰

```bash
~/.local/bin/development-harness dispatch reviewer T1        # 태스크의 고정 커밋 범위 리뷰
~/.local/bin/development-harness dispatch reviewer branch    # review 단계의 전체 브랜치 리뷰 (worktree가 main에서 갈라진 지점부터)
~/.local/bin/development-harness complete build docs/development/<slug>/build.json
~/.local/bin/development-harness complete review docs/development/<slug>/review.json
```

### 7. 브라우저 QA

```bash
~/.local/bin/development-harness dispatch browserQa QA-E2E-001
~/.local/bin/development-harness complete browser-qa docs/development/<slug>/qa.json
```

### 8. 최종 검증과 UAT

```bash
~/.local/bin/development-harness evidence
~/.local/bin/development-harness complete verification docs/development/<slug>/verification.json
~/.local/bin/development-harness decide approve 'UAT 승인, 브랜치 유지'
```

### 9. 브랜치 마무리

```bash
git add -- docs/development/<slug>/
git commit -m 'docs: 검증 근거'
~/.local/bin/development-harness complete finish docs/development/<slug>/verification.json
```

## 보고서 작성

워커 보고서와 단계 보고서는 다릅니다. 워커 보고서 형식은 [역할 지시](../agents/common/)와
[저장소 제어 정책](REPOSITORY-CONTROL.md)에 있습니다. 단계 보고서의 공통 필드는 아래와 같고,
새 실행은 [WORKFLOW.md](WORKFLOW.md)의 reviewer·QA 필드를 추가해야 수락됩니다.
`executor`는 **이 실행에 고정된 엔진 이름**이어야 합니다.

```json
{
  "verdict": "PASS",
  "head": "git rev-parse HEAD로 확인한 worktree의 실제 커밋",
  "fingerprint": "fingerprint 명령으로 확인한 실제 소스 지문",
  "commands": [{ "command": "실제로 실행한 명령", "exitCode": 0 }],
  "findings": [],
  "tasks": [
    {
      "id": "T1",
      "committer": "controller",
      "repository_control": { "mode": "controller_managed" },
      "base_commit": "실제 부모 SHA",
      "commit": { "sha": "실제 Controller commit SHA", "message": "실제 커밋 메시지" },
      "review_commit": "리뷰한 동일 commit SHA",
      "review_verdict": "PASS",
      "executor": "codex",
      "dispatch": "실제 워커 작업 ID 또는 실행 로그 경로",
      "red": "테스트 실패 로그",
      "green": "테스트 통과 로그",
      "review": "독립 리뷰 근거의 위치",
      "reviewer": { "executor": "claude", "role": "code-review", "dispatch": "리뷰 세션", "freshSession": true }
    }
  ]
}
```

`~/.local/bin/development-harness fingerprint`는 worktree의 소스 지문을 출력합니다. `evidence`는 worktree에서 승인된 `verificationCommands`를 실행하고
`verification.json`에 출력·종료 코드·HEAD·지문, 그리고 모든 승인 결정(누가, 전달인지)과 가드 ack를 기록합니다.
CLI만 바꿨다면 브라우저 테스트를 한 것처럼 적지 말고 `notApplicable`에 구체적인 이유를 적습니다.

## 가드

컨트롤러가 제품 코드를 쓰지 않는다는 규칙을 다섯 층이 지킵니다. 넷은 호스트와 무관합니다.

| 층 | 시점 | 호스트 | 동작 |
|---|---|---|---|
| hook | 쓰기 직전 | Claude Code만 | 컨트롤러의 편집 도구를 막습니다 |
| 감시자 | 쓰기 직후 | 모두 | 범위 밖 변경을 `.harness/guard.log`에 적고 출력합니다 |
| CLI 경고 | 다음 명령 | 모두 | 미확인 위반을 먼저 출력하고 `complete`·`decide`를 거부합니다 |
| pre-commit | 커밋 | 모두 | 범위 밖 파일을 stage한 커밋을 거부합니다 |
| 게이트 | 단계 전환 | 모두 | 실제 diff·워커 보고서·범위를 대조하고, 원장에 없는 커밋을 거부합니다 |

**범위 밖**이란 현재 디스패치된 태스크의 `allowed_files`에 없고 `docs/development/`도 아닌 변경입니다.
디스패치 전이나 커밋 후에는 모든 소스 변경이 범위 밖입니다. `.gitignore` 대상은 git이 보지 않는 그대로 제외됩니다.

위반이 뜨면 누가 왜 만들었는지 확인합니다. 워커가 만들었거나 되돌렸을 때만 사유와 함께 기록합니다.

```bash
~/.local/bin/development-harness guard --ack '워커 T3의 리팩터링이 범위를 넘었고 되돌렸음'
```

ack는 지우는 것이 아니라 설명을 붙여 남기는 것이고, 최종 검증 보고에 그대로 나옵니다.

pre-commit은 저장소의 모든 worktree가 공유하는 hooks 폴더에 설치되지만, 각 worktree의 git 관리 폴더에 있는 포인터를 따라
실행을 찾으므로 포인터가 없는 곳(메인 체크아웃 포함)에서는 아무것도 하지 않습니다.
`core.hooksPath`를 쓰는 저장소나 이미 다른 pre-commit이 있는 저장소에서는 설치하지 않고 그 사실을 `worktree` 출력과 `doctor`에 남깁니다.
CI나 테스트처럼 감시자를 띄우지 않으려면 `HARNESS_WATCH=off`를 설정합니다.

## 문제 해결과 상태 관리

| 상황 | 다음 행동 |
|---|---|
| 리뷰·QA에서 문제 발견 | `retry '<발견 사항과 재현 방법>' --task <task-id>`로 build 복귀 |
| 수정 라운드 한도 초과 | 근거와 함께 계획 수정을 요청. 태스크당 `maxFixRounds`, 전체 `maxTotalFixRounds` |
| 의존성 준비 실패 | `.harness/worktree-prepare.log` 확인 후 `prepare` |
| 가드 경고 | 원인을 확인하고 사실 그대로 `guard --ack`. 진행하려고 ack하지 않습니다 |
| 승인한 기획 문서 변경 | 해당 게이트에서 수정 요청. 이미 통과했다면 실행 보관 후 재계획 |
| 비정상 종료·잠금이 남음 | 관련 프로세스를 먼저 확인한 뒤 `.harness/lock` 복구 |
| 새 기능을 시작하려 함 | 기존 실행 완료·취소 후 `.harness`를 체크아웃 밖에 보관 |

`retry`는 build로 돌아가 이후 단계의 근거를 초기화합니다. UAT에서의 수정 요청은 수정 라운드로 세지 않습니다.
사람의 판단이 기계의 재시도 예산을 쓰지 않게 하기 위해서이고, 횟수는 히스토리에 남습니다.

하나의 체크아웃에는 하나의 실행만 둡니다. 상태는 Git이 추적하지 않는 `.harness/state.json`에 원자적으로 저장되고,
디렉터리 잠금으로 동시 수정을 막습니다. 상태 파일을 직접 고치지 마세요. reset 명령은 없습니다.

이 버전 이전에 시작한 실행은 상태가 worktree 안에 있습니다. 그런 실행은 그 worktree에서 예전 방식대로 완주합니다.

## 검증과 재사용

아래 명령은 **하네스 원본 저장소 자체를 검사할 때만** 씁니다. 대상 프로젝트 검증은 `evidence`입니다.

- `bun run check`: 타입 검사와 테스트
- `bun run smoke`: 상태 머신 흐름 테스트
- `bun run build`: CLI 번들

다른 저장소에서는 전역 설치 후 그 프로젝트에서 스킬을 부릅니다. `src`나 package 스크립트를 복사할 필요가 없습니다.

## 의존성과 적용 범위

필요한 것은 설정에 따라 다르고, `doctor`가 실제로 필요한 것만 확인합니다.

| 쓰는 것 | 필요한 것 |
|---|---|
| 항상 | Git, Bun |
| Claude Code 컨트롤러 | Claude Code, Superpowers, gstack(`plan-eng-review`, `review`), qa-planning 스킬 |
| `codex:` claude-agent 워커 | 사용자 범위 codex-plugin-cc와 Codex CLI |
| codex 브라우저 QA 워커 | `~/.codex/skills/harness-browser-qa` |
| shell 워커 | 그 명령의 실행 파일 |

codex-plugin-cc는 Claude Code에서 설치합니다.

```bash
claude plugin install codex@openai-codex --scope user
```

로그인은 자동으로 하지 않습니다. 의존성이 설치됐다는 사실만으로 로그인이나 모델 실행 성공이 확인된 것은 아닙니다.
이 저장소의 테스트는 모델을 호출하지 않습니다.

### 승인과 가드의 한계

사람 승인 게이트는 운영 절차이지 사용자 인증이 아닙니다. 파일시스템에 접근할 수 있으면 우회할 수 있습니다.
전달 승인도 인증이 아닙니다. 컨트롤러가 인용을 지어낼 수 있으므로, 전달 승인과 직접 승인이 히스토리와 보고에서 구별되고
조직이 `approval.allowRelay`로 끌 수 있다는 것이 통제의 전부입니다.

가드는 **차단이 아니라 검출**에 기댑니다. Claude Code가 아닌 호스트에서는 잘못된 변경이 일단 디스크에 쓰이고,
감시자·CLI·pre-commit·게이트가 되돌릴 수 있는 시점에 잡습니다. 감시자는 죽을 수 있고 파일 이벤트는 플랫폼에 따라 빠지므로,
`complete`·`decide`의 거부는 게이트의 대조가 독립적으로 뒷받침합니다.

shell 워커는 컨트롤러 호스트의 도구 권한 밖에서 돕니다. 범위 규칙은 프롬프트와 `scope`로 전달되고, 지켜졌는지는 게이트가 확인합니다.
워커 하위 프로세스는 Claude Code hook을 상속하지 않습니다. 권한 우회 옵션은 쓰지 마세요.

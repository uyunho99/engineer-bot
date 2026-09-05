# Claude Code 네이티브 개발 하네스 쿡북

> **사용 환경:** 일반 터미널의 Claude Code · `claude-only` 하네스 전역 설치
>
> **진행 담당:** Main Claude · **사용자 승인:** 제품 / 설계 / 계획 / 최종 UAT
>
> **기본 완료 동작:** 브랜치 유지. 두 하네스 브랜치를 merge하지 않습니다.

## 목차

- [빠른 시작](#빠른-시작)
- [전체 흐름과 역할](#전체-흐름과-역할)
- [단계별 실행](#단계별-실행)
- [보고서 작성](#보고서-작성)
- [문제 해결과 상태 관리](#문제-해결과-상태-관리)
- [검증과 재사용](#검증과-재사용)
- [설치 정보와 적용 범위](#설치-정보와-적용-범위)

## 빠른 시작

이 쿡북은 **전역 설치 후 개발할 프로젝트에서 실행하는 명령**을 기준으로 합니다.
Git, Bun, Claude Code, Codex CLI, Superpowers, gstack, codex-plugin-cc가 필요합니다.
처음 한 번은 하네스 원본 저장소에서 설치합니다. 자세한 clone 절차는 [README](../README.md)에 있습니다.

```bash
bun install --frozen-lockfile
bun run install:global
```

이후 사용할 프로젝트에서 Claude Code를 새로 실행합니다.

```bash
cd /path/to/your-project
~/.local/bin/development-harness doctor
claude
```

Claude에서 `/development-harness-native` 뒤에 개발 요청을 입력하세요.
처음 연결하는 프로젝트는 Claude가 `setup`을 실행하고, 실제 테스트·빌드 명령을 조사해
`configure`로 연결합니다. 기존 실행이 있으면 상태를 확인하고 재개합니다.
직접 연결할 때는 아래처럼 실행합니다. 검증 명령은 실제 프로젝트 명령으로 바꾸세요.

```bash
~/.local/bin/development-harness setup
~/.local/bin/development-harness configure '[["npm","test"],["npm","run","build"]]'
~/.local/bin/development-harness status
```

새 프로젝트라면 Git 저장소를 초기화하고 초기 커밋을 만든 뒤 `init`을 실행합니다.
`setup`은 프로젝트의 설정 파일과 `.gitignore` 항목을 추가하며 소스·package.json·CLAUDE.md를 복사하지 않습니다.
검증 명령은 `harness.config.json`의 `verificationCommands`에 저장합니다.
계획 완료 전에 명령을 설정해야 하며, 승인 후 설정 변경은 감지되어 진행이 차단됩니다.

**시작 전 확인**

- [ ] 개발할 프로젝트 폴더에서 실행하고 있습니다.
- [ ] 전역 설치를 완료하고 Claude Code를 새로 열었습니다.
- [ ] `doctor`가 필요한 로컬 도구를 확인했습니다.
- [ ] 기존 실행이 있다면 `status`로 재개 지점을 확인했습니다.

## 전체 흐름과 역할

```text
기획 → [제품 승인] → 설계 → [설계 승인] → 구현 계획 + QA 계획
     → [계획 승인] → worktree → TDD 구현 → 독립 리뷰 → 브라우저 QA
     → 최종 검증 → [UAT 승인] → 브랜치 유지

실패·UAT 수정 요청 → TDD 구현 → 리뷰 → QA → 검증 반복
```

| 순서 | 단계 | 담당 | 완료 기준 / 산출물 |
|---|---|---|---|
| 1 | 기획 → 제품 승인 | Main Claude → 사용자 | `01-brainstorm.md` 검토 |
| 2 | 설계 → 설계 승인 | Main Claude → 사용자 | `02-design.md` 검토 |
| 3 | 구현·QA 계획 → 계획 승인 | Main Claude → 사용자 | `03-plan.md`에 두 계획 포함 |
| 4 | 작업 공간 분리 | Main Claude | 승인 자료 커밋 후 새 worktree |
| 5 | TDD 구현 | 구현 하위 에이전트 | 실패 → 통과 로그, 개별 리뷰 |
| 6 | 독립 리뷰 → 브라우저 QA | 리뷰·QA 담당 | `review.json`, `qa.json` |
| 7 | 최종 검증 → UAT 승인 | 검증 담당 → 사용자 | `verification.json`, 변경 내용 검토 |
| 8 | 마무리 | Main Claude | 승인된 결과 커밋, 브랜치 유지 |

**읽는 방법:** 아래 명령은 각 단계의 산출물이 준비됐을 때 실행합니다. 전체를 한 번에 붙여 넣지 마세요.

## 단계별 실행

### 1. 실행 생성과 제품 승인

```bash
~/.local/bin/development-harness init invite-team
~/.local/bin/development-harness status
# 담당 Claude가 기획 문서를 작성한 뒤 실행합니다.
~/.local/bin/development-harness complete brainstorm docs/development/invite-team/01-brainstorm.md
# 사용자가 문서를 검토한 뒤 직접 실행합니다. 마지막 인수는 실제 승인 근거입니다.
~/.local/bin/development-harness decide approve '대화 12번 메시지에서 제품 기획 승인'
# 수정 요청은 decide revise '초대 범위 수정', 취소는 decide cancel '이 기능 개발 취소'입니다.
```

### 2. 설계·계획 승인

| 승인 대상 | 작성할 파일 | 사용자 확인 사항 |
|---|---|---|
| 설계 | `02-design.md` | 구조와 사용자 흐름이 요구사항에 맞는가? |
| 계획 | `03-plan.md` | 구현 순서와 QA 기준이 모두 정해졌는가? |

각 문서를 작성하고 해당 `design` / `plan` 단계를 완료한 뒤 사용자 승인을 받습니다.
**사용자가 검토하고 자신의 터미널에서 승인 명령을 실행해야 다음 단계로 진행합니다.**

### 3. 승인된 계획으로 worktree 생성

계획을 승인한 뒤에는 기획 산출물을 커밋하고 별도 worktree를 만듭니다.
아래의 `/absolute/new/checkout`은 새로 만들 체크아웃의 실제 절대 경로로 바꾸세요.

```bash
git add docs/development harness.config.json .gitignore
git commit -m 'docs: 기능 계획 승인'
~/.local/bin/development-harness worktree /absolute/new/checkout feature/invite-team
cd /absolute/new/checkout
# 대상 프로젝트에 맞는 의존성 설치와 기준 검사를 수행한 뒤 실행합니다.
claude
```

원래 체크아웃의 실행 상태는 `transferred`로 바뀝니다. 이후에는 새 worktree로 복사된 실행을 이어갑니다.
경로나 브랜치가 이미 존재하면 Git이 생성을 거부합니다. 이 명령은 브랜치를 merge하거나 worktree를 삭제하지 않습니다.

### 4. 구현 결과 확인

> 다음 명령의 JSON 파일은 실제 구현·리뷰·QA 결과를 기록한 보고서입니다. 형식은 [보고서 작성](#보고서-작성)을 참고하세요.

```bash
~/.local/bin/development-harness complete build docs/development/invite-team/build.json
```

### 5. 리뷰 결과 확인

```bash
~/.local/bin/development-harness complete review docs/development/invite-team/review.json
```

### 6. 브라우저 QA 결과 확인

```bash
~/.local/bin/development-harness complete browser-qa docs/development/invite-team/qa.json
```

### 7. 최종 검증 실행

```bash
~/.local/bin/development-harness evidence
~/.local/bin/development-harness complete verification docs/development/invite-team/verification.json
```

### 8. 사용자 UAT 승인

```bash
# 사용자가 변경 내용, 브라우저 근거, 테스트 결과를 검토한 뒤 승인합니다.
~/.local/bin/development-harness decide approve '대화 42번 메시지에서 UAT 승인, 브랜치 유지'
```

### 9. 브랜치 마무리

```bash
# 승인된 코드와 보고서를 모두 커밋한 뒤 완료합니다.
# finish는 검증 당시와 소스 지문이 같은지 확인합니다.
# 보고서의 HEAD는 마지막 근거 자료 커밋보다 이전일 수 있습니다.
~/.local/bin/development-harness complete finish docs/development/invite-team/verification.json
```

## 보고서 작성

보고서는 다음 구조의 JSON으로 작성합니다. 아래 설명용 문자열은 실제 실행 근거로 바꿔야 합니다.

```json
{
  "verdict": "PASS",
  "head": "git rev-parse HEAD로 확인한 실제 커밋",
  "fingerprint": "fingerprint 명령으로 확인한 실제 소스 지문",
  "commands": [
    {
      "command": "실제로 실행한 명령",
      "exitCode": 0
    }
  ],
  "findings": [],
  "tasks": [
    {
      "id": "T1",
      "red": "테스트 실패 로그",
      "green": "테스트 통과 로그",
      "review": "독립 리뷰 근거의 위치"
    }
  ],
  "scenarios": [
    {
      "id": "QA1",
      "url": "실제로 테스트한 로컬 URL",
      "result": "PASS",
      "evidence": "스크린샷 또는 브라우저 출력"
    }
  ]
}
```

소스 지문은 다음 명령으로 확인합니다.

```bash
~/.local/bin/development-harness fingerprint
```

CLI만 변경했다면 브라우저 테스트를 실행한 것처럼 기록하지 말고, `notApplicable`에 해당하지 않는 구체적인 이유를 적으세요.
UI를 변경한 작업에는 실제 브라우저 테스트 시나리오와 결과가 필요합니다.

`~/.local/bin/development-harness evidence`는 프로젝트 루트에서 승인된 `verificationCommands`를 실행한 뒤 `verification.json`을 작성합니다.
여기에는 표준 출력, 표준 오류, 종료 코드, HEAD, 소스 지문이 포함됩니다.
프로젝트별 수용 기준을 확인하는 명령이 있다면 그 실행 결과도 보고서에 추가합니다.

## 문제 해결과 상태 관리

| 상황 | 다음 행동 |
|---|---|
| 리뷰·QA에서 문제 발견 | 재현 방법을 기록하고 `retry`로 구현 단계 복귀 |
| 승인한 기획 문서 변경 | 해당 게이트에서 수정 요청. 이미 통과했다면 실행 보관 후 재계획 |
| 비정상 종료·잠금이 남음 | 관련 프로세스를 먼저 확인한 뒤 복구 |
| 새 기능을 시작하려 함 | 기존 실행 완료·취소 후 `.harness`를 체크아웃 밖에 보관 |

### 수정 후 다시 진행하기

`retry 'finding with reproduction'`은 `build`로 돌아가 이후 단계의 근거 기록을 초기화합니다.
인수에는 발견 사항과 재현 방법을 적으세요.
승인된 기획 문서를 바꾸려면 해당 게이트에서 수정을 요청해야 합니다.
이미 게이트를 통과했다면 진행을 멈추고 기존 실행을 보관한 뒤 명시적으로 다시 계획합니다.
승인된 산출물을 알리지 않고 덮어쓰면 안 됩니다.

### 상태 파일과 보관 위치

하나의 체크아웃에서는 하나의 실행만 진행합니다. 상태는 Git 추적에서 제외된 `.harness/state.json`에 저장합니다.
파일을 원자적으로 교체해 저장 도중 데이터가 일부만 기록되는 상황을 방지하고, 디렉터리 생성 방식의 배타적 잠금으로 동시 수정을 막습니다.
모든 단계 전환에는 시각과 근거 자료의 해시가 기록됩니다.

상태 파일을 직접 수정하지 마세요. 비정상 종료 후 남은 잠금을 해제하려면 먼저 관련 프로세스가 실행 중인지 확인해야 합니다.
완료하거나 취소한 실행 다음에 새 실행을 시작할 때는 기존 `.harness` 디렉터리를 체크아웃 밖에 보관합니다.
진행 중인 작업을 지우는 reset 명령은 제공하지 않습니다. 산출물은 모두 `docs/development/<slug>`에 작성합니다.
`<slug>`는 `invite-team`처럼 기능을 구분하는 이름입니다.

## 검증과 재사용

아래 세 명령은 **하네스 원본 저장소 자체를 개발·검사할 때만** 사용합니다.
대상 프로젝트 검증은 위의 전역 `evidence` 명령을 사용합니다.

- `bun run check`: TypeScript 타입 검사와 테스트를 실행합니다.
- `bun run smoke`: 전체 단계 흐름을 검사하는 테스트를 실행합니다.
- `bun run build`: Bun CLI를 번들로 만들어 `dist`에 저장합니다.

기존 저장소에는 빌드 명령이 없어 이번 브랜치에서 추가했습니다.
필수 승인 없이 진행할 수 있었던 기존 `plan --execute` 경로는 제거했습니다.

다른 저장소에는 전역 설치 후 해당 프로젝트에서 스킬을 호출하세요.
`src`나 package 스크립트를 복사할 필요가 없습니다. 프로젝트별 검증 명령만 연결합니다.

## 설치 정보와 적용 범위

### Codex 플러그인이 없는 경우

Codex 플러그인이 없다면 Claude에서 다음 명령을 실행합니다. 설치 방법은 실제 제공되는 명령을 기준으로 확인했습니다.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

여러 프로젝트에서 사용하려면 터미널에서 사용자 범위로 설치합니다.

```bash
claude plugin install codex@openai-codex --scope user
```

`doctor`는 사용자 범위 설치를 요구합니다.
로그인은 자동으로 진행하지 않습니다. 설치 후 `/agents` 목록에 `codex:codex-rescue`가 표시되는지 확인하세요.

### 확인한 의존성 — 2026-09-05

- Claude Code 2.1.261, Bun 1.3.14.
- Superpowers 6.2.0 설치 확인. `superpowers-dev` 6.3.0도 있으나 안정 버전의 스킬 이름을 사용합니다.
- gstack 1.6.1.0, 커밋 `656df0e`. 접두사 설정은 `false`이므로 존재하지 않는 `gstack-` 별칭을 가정하지 않습니다.
- codex-plugin-cc 1.0.6, 소스 커밋 `db52e28f4d9ded852ab3942cea316258ae4ef346`.
- 공식 참고 자료: [codex-plugin-cc](https://github.com/openai/codex-plugin-cc), [Claude 스킬](https://code.claude.com/docs/en/skills), [Claude hooks](https://code.claude.com/docs/en/hooks).

새 세션에서는 `doctor`로 로컬 파일을 다시 확인합니다.
의존성이 설치됐다는 사실만으로 로그인이나 유료 모델 실행 성공까지 확인된 것은 아닙니다.
이 저장소의 테스트는 모델을 호출하지 않습니다.

### 승인·hook의 적용 범위

사람 승인 게이트는 운영 절차이며 사용자 인증 기능은 아닙니다. 파일시스템 접근 권한이 있는 사람은 이를 우회할 수 있습니다.
담당 Claude는 받지 않은 승인을 대신 만들어 `decide`를 실행하면 안 됩니다.
승인은 사용자가 자신의 터미널에서 기록합니다.

전역 hook은 `harness.config.json`의 `mode`가 `claude-only`인 프로젝트에 적용됩니다.
Hook은 `build` 단계 밖에서 구조화된 파일 편집 도구로 소스를 수정하는 행동과 에이전트가 사람 승인을 기록하는 행동을 차단합니다.
셸과 플러그인 하위 프로세스에는 기존 사용자 권한 정책이 적용되며, 승인된 작업 범위를 따라야 합니다.
소스 지문은 리뷰 이후 코드가 변경됐는지 확인하는 데 사용합니다.
이 장치는 운영 절차를 보조하며 OS 수준의 격리 환경을 제공하지 않습니다.
Codex 하위 프로세스는 Claude hook을 상속하지 않으므로, Codex 리뷰에는 읽기 전용 범위를 명시하고 권한 우회 옵션을 사용하지 마세요.

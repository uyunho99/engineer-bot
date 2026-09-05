# Claude Code 네이티브 개발 하네스 쿡북

## 설치와 첫 실행

Git, Bun, Claude Code, Superpowers, gstack, codex-plugin-cc가 필요합니다.
이 브랜치는 프로젝트 안의 Claude 스킬과 hook을 사용하므로 홈 디렉터리에 파일을 복사할 필요가 없습니다.

```bash
bun install --frozen-lockfile
bun run harness doctor
claude
```

Claude에서 `/development-harness-native` 뒤에 개발 요청을 입력하거나, 구현할 기능을 자연어로 설명하세요.
Claude가 이미 실행 중이었다면 플러그인을 다시 불러오세요.

Codex 플러그인이 없다면 Claude에서 다음 명령을 실행합니다. 설치 방법은 실제 제공되는 명령을 기준으로 확인했습니다.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

이번 로컬 설치에는 Claude CLI의 `plugin install --scope project`를 사용했습니다.
로그인은 자동으로 진행하지 않습니다. 설치 후 `/agents` 목록에 `codex:codex-rescue`가 표시되는지 확인하세요.

## 상태 관리와 승인 명령

하나의 체크아웃에서는 하나의 실행만 진행합니다. 상태는 Git 추적에서 제외된 `.harness/state.json`에 저장합니다.
파일을 원자적으로 교체해 저장 도중 데이터가 일부만 기록되는 상황을 방지하고, 디렉터리 생성 방식의 배타적 잠금으로 동시 수정을 막습니다.
모든 단계 전환에는 시각과 근거 자료의 해시가 기록됩니다.

상태 파일을 직접 수정하지 마세요. 비정상 종료 후 남은 잠금을 해제하려면 먼저 관련 프로세스가 실행 중인지 확인해야 합니다.
완료하거나 취소한 실행 다음에 새 실행을 시작할 때는 기존 `.harness` 디렉터리를 체크아웃 밖에 보관합니다.
진행 중인 작업을 지우는 reset 명령은 제공하지 않습니다. 산출물은 모두 `docs/development/<slug>`에 작성합니다.
`<slug>`는 `invite-team`처럼 기능을 구분하는 이름입니다.

```bash
bun run harness init invite-team
bun run harness status
# 담당 Claude가 기획 문서를 작성한 뒤 실행합니다.
bun run harness complete brainstorm docs/development/invite-team/01-brainstorm.md
# 사용자가 문서를 검토한 뒤 직접 실행합니다. 마지막 인수는 실제 승인 근거입니다.
bun run harness decide approve 'Reviewed product, conversation message 12'
# 수정 요청은 decide revise 'Change the scope', 취소는 decide cancel 'Cancel this feature'입니다.
```

`design`과 `plan`에서도 문서 작성 → 단계 완료 → 사용자 승인을 반복합니다.
계획 문서에는 **구현 계획과 QA 계획을 모두** 포함해야 합니다.

사람 승인 게이트는 운영 절차이며 사용자 인증 기능은 아닙니다. 파일시스템 접근 권한이 있는 사람은 이를 우회할 수 있습니다.
담당 Claude는 받지 않은 승인을 대신 만들어 `decide`를 실행하면 안 됩니다.
승인은 사용자가 자신의 터미널에서 기록합니다.

Hook은 `build` 단계 밖에서 구조화된 파일 편집 도구로 소스를 수정하는 행동과 에이전트가 사람 승인을 기록하는 행동을 차단합니다.
셸과 플러그인 하위 프로세스에는 기존 사용자 권한 정책이 적용되며, 승인된 작업 범위를 따라야 합니다.
소스 지문은 리뷰 이후 코드가 변경됐는지 확인하는 데 사용합니다.
이 장치는 운영 절차를 보조하며 OS 수준의 격리 환경을 제공하지 않습니다.
Codex 하위 프로세스는 Claude hook을 상속하지 않으므로, Codex 리뷰에는 읽기 전용 범위를 명시하고 권한 우회 옵션을 사용하지 마세요.

계획을 승인한 뒤에는 기획 산출물을 커밋하고 별도 worktree를 만듭니다.
아래의 `/absolute/new/checkout`은 새로 만들 체크아웃의 실제 절대 경로로 바꾸세요.

```bash
git add docs/development
git commit -m 'docs: approve feature plan'
bun run harness worktree /absolute/new/checkout feature/invite-team
cd /absolute/new/checkout
bun install --frozen-lockfile
claude
```

원래 체크아웃의 실행 상태는 `transferred`로 바뀝니다. 이후에는 새 worktree로 복사된 실행을 이어갑니다.
경로나 브랜치가 이미 존재하면 Git이 생성을 거부합니다. 이 명령은 브랜치를 merge하거나 worktree를 삭제하지 않습니다.

## 구현·리뷰·QA·검증 근거

`build` → `review` → `browser-qa` → `verification` 순서로 단계를 완료합니다.
이후 사용자 인수 테스트인 UAT 승인을 받고 `finish`를 완료합니다.
보고서는 다음 구조의 JSON으로 작성합니다. 아래 설명용 문자열은 실제 실행 근거로 바꿔야 합니다.

```json
{
  "verdict": "PASS",
  "head": "git rev-parse HEAD로 확인한 실제 커밋",
  "fingerprint": "src/store.ts로 계산한 실제 소스 지문",
  "commands": [{"command": "실제로 실행한 명령", "exitCode": 0}],
  "findings": [],
  "tasks": [{"id":"T1", "red":"테스트 실패 로그", "green":"테스트 통과 로그", "review":"독립 리뷰 근거의 위치"}],
  "scenarios": [{"id":"QA1", "url":"실제로 테스트한 로컬 URL", "result":"PASS", "evidence":"스크린샷 또는 브라우저 출력"}]
}
```

소스 지문은 다음 명령으로 확인합니다.

```bash
bun -e 'import {fingerprint} from "./src/store.ts"; console.log(fingerprint(process.cwd()))'
```

CLI만 변경했다면 브라우저 테스트를 실행한 것처럼 기록하지 말고, `notApplicable`에 해당하지 않는 구체적인 이유를 적으세요.
UI를 변경한 작업에는 실제 브라우저 테스트 시나리오와 결과가 필요합니다.

`bun run evidence`는 저장소의 검사와 빌드를 실행한 뒤 `verification.json`을 작성합니다.
여기에는 표준 출력, 표준 오류, 종료 코드, HEAD, 소스 지문이 포함됩니다.
프로젝트별 수용 기준을 확인하는 명령이 있다면 그 실행 결과도 보고서에 추가합니다.

```bash
bun run harness complete build docs/development/invite-team/build.json
bun run harness complete review docs/development/invite-team/review.json
bun run harness complete browser-qa docs/development/invite-team/qa.json
bun run evidence
bun run harness complete verification docs/development/invite-team/verification.json
# 사용자가 변경 내용, 브라우저 근거, 테스트 결과를 검토한 뒤 승인합니다.
bun run harness decide approve 'UAT accepted in message 42; keep branch'
# 승인된 코드와 보고서를 모두 커밋한 뒤 완료합니다.
# finish는 검증 당시와 소스 지문이 같은지 확인합니다.
# 보고서의 HEAD는 마지막 근거 자료 커밋보다 이전일 수 있습니다.
bun run harness complete finish docs/development/invite-team/verification.json
```

`retry 'finding with reproduction'`은 `build`로 돌아가 이후 단계의 근거 기록을 초기화합니다.
인수에는 발견 사항과 재현 방법을 적으세요.
승인된 기획 문서를 바꾸려면 해당 게이트에서 수정을 요청해야 합니다.
이미 게이트를 통과했다면 진행을 멈추고 기존 실행을 보관한 뒤 명시적으로 다시 계획합니다.
승인된 산출물을 알리지 않고 덮어쓰면 안 됩니다.

## 검증 명령과 다른 저장소에서의 재사용

- `bun run check`: TypeScript 타입 검사와 테스트를 실행합니다.
- `bun run smoke`: 전체 단계 흐름을 검사하는 테스트를 실행합니다.
- `bun run build`: Bun CLI를 번들로 만들어 `dist`에 저장합니다.

기존 저장소에는 빌드 명령이 없어 이번 브랜치에서 추가했습니다.
필수 승인 없이 진행할 수 있었던 기존 `plan --execute` 경로는 제거했습니다.

다른 저장소에서 사용하려면 `.claude/skills/development-harness-native`, `src`, `harness.config.json`, package 스크립트를 복사합니다.
`CLAUDE.md`와 hook 항목은 대상 저장소의 기존 지침을 보존하면서 필요한 내용을 추가하세요.
검증 명령은 그 저장소에 문서화된 빌드·테스트 명령에 맞게 조정합니다.
Bun과 플러그인 의존성도 필요하며, `SKILL.md`만 복사한다고 실행 환경이 설치되지는 않습니다.

## 확인한 의존성: 2026-09-05 기준

- Claude Code 2.1.261, Bun 1.3.14.
- Superpowers 6.2.0 설치 확인. `superpowers-dev` 6.3.0도 있으나 안정 버전의 스킬 이름을 사용합니다.
- gstack 1.6.1.0, 커밋 `656df0e`. 접두사 설정은 `false`이므로 존재하지 않는 `gstack-` 별칭을 가정하지 않습니다.
- codex-plugin-cc 1.0.6, 소스 커밋 `db52e28f4d9ded852ab3942cea316258ae4ef346`.
- 공식 참고 자료: [codex-plugin-cc](https://github.com/openai/codex-plugin-cc), [Claude 스킬](https://code.claude.com/docs/en/skills), [Claude hooks](https://code.claude.com/docs/en/hooks).

새 세션에서는 `doctor`로 로컬 파일을 다시 확인합니다.
의존성이 설치됐다는 사실만으로 로그인이나 유료 모델 실행 성공까지 확인된 것은 아닙니다.
이 저장소의 테스트는 모델을 호출하지 않습니다.

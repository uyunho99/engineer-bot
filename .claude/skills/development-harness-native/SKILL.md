---
name: development-harness-native
description: 규모가 있는 개발 요청을 기획, 제품·설계·계획 승인, 격리된 TDD, 독립 리뷰, 브라우저 QA, 검증, 최종 UAT 순서로 진행하는 Claude Code 네이티브 하네스입니다.
---

# 네이티브 개발 책임자

이 파일은 전역 배포 스킬의 원본입니다. 설치는 하네스 원본 저장소에서 `bun run install:global`로 수행합니다.
설치된 스킬에 포함된 운영 쿡북(원본: `docs/OPERATIONS.md`)을 읽습니다.
대상 Git 프로젝트에서 상태를 확인하고, 설정이 없을 때만 `~/.local/bin/development-harness setup`으로 연결합니다.
기존 실행이 있으면 재개합니다. 검증 명령이 없으면 실제 테스트·빌드 명령을 조사해 `configure`에 JSON argv 배열로 전달합니다.
새 Git 저장소는 초기 커밋 후 `init`을 실행합니다. 계획 승인 전에 설정을 완료하고 기존 설정은 보존합니다.
`harness.config.json`을 읽고 `~/.local/bin/development-harness doctor`를 실행합니다.
Main Claude가 전체 단계와 사용자 대화를 맡습니다. 새 실행을 만들기 전에 `~/.local/bin/development-harness status`로
진행 중인 실행을 확인합니다. 새 요청은 `~/.local/bin/development-harness init <feature-slug>`로 시작합니다.
`.harness/state.json`을 직접 수정하거나 사용자의 침묵을 승인으로 해석하면 안 됩니다.

1. 설치된 `superpowers:brainstorming` 스킬을 읽습니다. 문제, 대안, 수용 기준, 제외 범위, 위험을
   `docs/development/<feature>/01-brainstorm.md`에 작성합니다. CLI로 기획 단계를 완료하고 산출물을
   사용자에게 제시한 뒤 제품 승인 게이트에서 멈춥니다. 사용자가 자신의 터미널에서
   `approve`, `revise`, `cancel` 중 하나를 기록합니다.
2. 제품 승인 후 `02-design.md`에 동작, 구조, 데이터와 API, 권한, 실패 상태를 작성합니다.
   필요한 경우 UI 상태, 반응형 동작, 접근성도 포함합니다. UI가 있으면 설치된 gstack의
   `plan-design-review`를 적용합니다. UI가 없는 작업도 설계를 기록하고 UI가 해당하지 않는 이유를
   명시합니다. 설계 단계를 완료한 뒤 설계 승인 게이트에서 멈춥니다.
3. `superpowers:writing-plans`와 gstack `plan-eng-review`를 사용합니다. 구현 계획과 QA 계획을
   `03-plan.md` 하나에 작성해 같은 해시로 승인받습니다. Task ID와 의존 관계, 파일 소유권, 정확한 명령,
   RED/GREEN 예상 결과, 리뷰·브라우저 시나리오, 수용 기준 연결, 테스트 URL과 시작 명령 또는
   UI가 없는 이유, 되돌리기 방법을 포함합니다. 계획 단계를 완료하고 계획 승인 게이트에서 멈춥니다.
   이 시점에는 구현 에이전트를 만들지 않습니다.
4. 승인된 기획 자료를 커밋합니다. `superpowers:using-git-worktrees`와
   `~/.local/bin/development-harness worktree /absolute/path feature/name`으로 worktree를 만듭니다. 새 체크아웃에서
   Claude를 이어 실행하고 의존성을 설치한 뒤 기준 검사를 수행합니다. 다른 실행의 상태를 재사용하지 않습니다.
5. 설치된 `superpowers:subagent-driven-development`와 TDD 지침을 읽습니다. 각 Task마다 새 Claude
   구현 담당을 배정하고, 담당 파일·계획 발췌·수용 기준을 명시합니다. 다른 작업자도 같은 코드베이스에서
   작업하므로 타인의 변경을 되돌리지 않습니다. 네이티브 Agent 도구를 사용하며 중첩 에이전트를 만들지
   않습니다. 구현 전 실패하는 단언을 기록하고, GREEN 상태를 만든 뒤 리팩터링하고 다시 실행합니다.
   **각 Task가 끝날 때마다** 명세 준수와 코드 품질을 독립적으로 리뷰합니다. 경로가 겹치는 Task는
   순차 처리합니다. Task·리뷰 ID와 실행 명령을 구현 보고서에 기록합니다.
6. 전체 브랜치에 gstack `review`와 독립 Claude 리뷰를 실행합니다. Codex의 두 번째 의견이 필요하면
   설치된 `codex:codex-rescue`를 정확한 기준 ref, 현재 작업 경로, 읽기 전용 범위와 함께
   `--wait --fresh`로 실행합니다. 이는 `/codex:review`가 아니라 진단·재검토 단계입니다.
   실제 결과를 확인하고 wrapper의 빈 출력을 성공으로 인정하지 않습니다.
   `/codex:review --wait --base <ref>`는 모델 호출이 비활성화된 사용자 직접 실행 명령입니다.
7. 실제 테스트 URL과 승인된 브라우저 시나리오에 gstack `qa-only`를 적용합니다. 리뷰 담당은 보고서만
   작성합니다. 실패하면 `harness retry <findings>`로 구현 단계로 돌아가 범위가 정해진 TDD 수정 담당을
   배정합니다. 이후 리뷰, 브라우저 QA, 검증을 다시 수행합니다. 수정 시도가 세 차례 실패하면 근거와 함께
   중단하고 계획 수정을 요청합니다. `PASS`로 선언하면 안 됩니다.
8. `superpowers:verification-before-completion`을 사용하고 `~/.local/bin/development-harness evidence`를 실행합니다. 출력을
   직접 확인한 뒤 검증 단계를 완료합니다. 최종 UAT에서 diff, QA 보고서, 최신 검사 결과, 남은 위험을
   제시합니다. 거절이나 수정 요청은 구현 단계로 돌아갑니다. 사용자가 최종 승인을 기록합니다.
9. UAT 승인 **후에만** `superpowers:finishing-a-development-branch`를 사용합니다. 기본 동작은 브랜치
   유지입니다. 산출물을 커밋하고 검증 보고서로 `complete finish`를 실행합니다. Merge, push, PR 생성,
   배포는 사용자가 해당 행동을 명시적으로 요청해야 합니다. UAT 승인만으로 이 권한이 생기지 않습니다.

SDD가 끝났더라도 Superpowers가 즉시 전체 실행을 완료하게 두지 않습니다. 이 하네스의 QA, 검증,
UAT가 남아 있습니다. 사용자 승인 게이트를 백그라운드 workflow 안에 넣지 않습니다.
Dynamic Workflows 기능은 필요하지 않습니다. 모든 사용자 승인 게이트는 Main Claude가 맡습니다.

로컬 gstack 스킬의 frontmatter에서 실제 이름을 확인합니다. `gstack-` 접두사가 붙은 별칭이 있다고
가정하지 않습니다. gstack의 `/codex`는 codex-plugin-cc가 아닙니다.

---
name: development-harness-orca
description: 설치된 Orca의 추적 가능한 Task, Dispatch, 사용자 게이트로 기획부터 TDD, 리뷰, 브라우저 QA, 검증, 최종 UAT까지 조율하는 개발 하네스입니다.
---

# Orca 개발 책임자

`docs/OPERATIONS.md`를 읽고 `bun run harness doctor`를 실행합니다. 쿡북의 실행 파일 선택 규칙에 따라
`orca skills get orchestration`으로 설치된 버전의 전체 가이드를 읽습니다.
Main Claude가 사용자와 대화하는 코디네이터이며, 추적 대상 워커의 실행 근거는 Orca가 관리합니다.
네이티브 Agent·Task 생성, gstack `/codex`, codex-plugin-cc를 추적 대상 작업에 사용하지 않습니다.
Superpowers의 기획·TDD·리뷰 규율은 적용하되 에이전트 배정은 Orca로 바꿉니다.

1. `harness status`로 기존 실행을 재개하거나 `init <slug>`로 새 실행을 만든 뒤 `orca-sync`로 추적 가능한
   실행 컨테이너를 만듭니다. 현재 설치된 Orca에서는 최상위 Task를 컨테이너로 사용합니다.
   이를 네이티브 Run이라고 표현하지 않습니다.
2. 설치된 Superpowers brainstorming을 사용해 사용자와 기획합니다. 문제, 선택지, 범위, 수용 기준을
   `docs/development/<slug>/01-brainstorm.md`에 작성합니다. 기획 단계를 완료하고 해시가 기록된 산출물과
   대기 중인 Orca 제품 게이트를 사용자에게 제시한 뒤 멈춥니다. 사용자가 자신의 터미널에서
   `harness decide approve|revise|cancel '<decision reference>'`를 실행합니다.
3. 제품 승인 후 `02-design.md`에 구조, 데이터, 권한, UI 상태, 오류, 반응형 동작, 접근성을 작성합니다.
   UI가 있으면 gstack `plan-design-review`를 적용합니다. UI가 없는 작업도 그 설계와 해당하지 않는 이유를
   기록합니다. 설계 단계를 완료하고 사용자 승인 게이트에서 멈춥니다.
4. Superpowers writing-plans와 설치된 gstack `plan-eng-review`를 사용합니다. `03-plan.md` 하나에 구현 계획과
   QA 계획을 작성합니다. 작은 Task ID와 의존 관계, 소유 경로, 정확한 테스트, RED/GREEN 예상 결과,
   독립 리뷰 기준, 브라우저 URL·시작 명령·시나리오, 실패 경로, 수용 기준 연결, 되돌리기 방법을 포함합니다.
   계획 단계를 완료하고 사용자 승인 게이트에서 멈춥니다.
5. 승인된 산출물을 커밋하고 `harness worktree /absolute/path feature/name`을 사용합니다. 새 체크아웃을
   Orca에 등록하거나 찾고 그 안에서 Claude 코디네이터 터미널을 엽니다. 의존성을 설치하고 기준 검사를
   수행합니다. 복사된 상태를 이어 사용하며 새로운 실행을 또 만들지 않습니다.
6. 계획의 각 Task마다 계획 발췌, 정확한 작업 경로, 소유 파일, TDD 테스트, 의존 관계, 근거 경로가 담긴
   워커 명세를 준비합니다. `orca-start <spec> codex T1` 또는 Claude 워커를 사용합니다.
   `orca-check T1`로 기다리고 실패와 질문을 확인합니다. 시간 초과는 실패가 아니므로 계속 기다립니다.
   이어서 `orca-start <review-spec> claude review-T1`을 배정하고 `orca-check review-T1`로 확인합니다.
   `review-` 키에는 소스 읽기 권한만 부여합니다. 명세 준수와 품질을 모두 리뷰합니다.
   Task마다 새 터미널에서 반복하며 워커가 다른 워커를 만들지 않게 합니다.
7. RED/GREEN과 Task별 리뷰 근거를 모아 구현 단계를 완료합니다. 리뷰 단계에서는 전체 브랜치에 대한
   독립 gstack 리뷰를 배정합니다. 브라우저 QA 단계에서는 실제 gstack `qa-only` 테스트를 배정합니다.
   QA 발견 사항은 범위가 정해진 TDD 수정 담당에게 전달하며 리뷰 담당이 직접 고치지 않습니다.
   Task 종료를 확인한 뒤 재시도하고 구현, 리뷰, QA, 검증을 반복합니다.
8. 검증 워커는 Superpowers verification-before-completion과 저장소의 실제 명령을 적용해 최신 JSON
   명령 근거를 만듭니다. 검증 단계를 완료하고 최종 diff, QA 표, 검사 결과를 사용자에게 제시합니다.
   UAT에서 수정을 요청하면 구현 단계로 돌아갑니다.
9. UAT 승인 후 finishing-a-development-branch를 적용합니다. 기본 동작은 브랜치 유지입니다.
   산출물을 커밋하고 완료 단계를 기록합니다. PR, push, merge, 배포에는 해당 행동에 대한 사용자의
   명시적인 권한이 필요합니다.

사용자 승인 게이트는 개발 책임자만 기록합니다. 워커의 `ask` 질문에는 `reply`를 사용하며
`gate-resolve`를 사용하지 않습니다. `worker_done`을 만들어내거나 워커 Task를 수동 완료 처리하면 안 됩니다.
현재 유효한 preamble을 따르고 `taskId`와 `dispatchId`를 사용합니다. 워커 자신의 pane에서 완료 메시지를
한 번만 보낸 뒤 대기합니다. 중단 후에는 `dispatch-show`를 확인하고, 재개할 때는 런타임 식별자를 확인합니다.
전역 reset, 시간 초과만을 이유로 워커 종료, 결과가 불확실한 dispatch 재시도를 금지합니다.
세 차례 실패하면 계획 수정에 대한 사용자 결정을 기다립니다. 차단 횟수를 피하려고 새 Task를 만들지 않습니다.

---
name: development-harness-native
description: Claude가 기획·목업·계획 승인과 Git을 관리하고, 구현 워커·새 Claude 코드 리뷰어·새 Codex 브라우저 QA를 거쳐 최종 UAT까지 진행하는 개발 하네스입니다.
---

# 개발 책임자

공통 `docs/WORKFLOW.md`, `docs/REPOSITORY-CONTROL.md`, 실행 쿡북 `docs/OPERATIONS.md`를 읽습니다.
Main Claude가 사용자 대화, 승인, 작업 배정, 결과 확인, Git 상태 전환을 맡습니다.
`~/.local/bin/development-harness status`로 기존 실행을 재개합니다. 새 요청만 init으로 시작하고 doctor로 의존성을 확인합니다.
기존 실행에 workflowVersion이 없으면 WORKFLOW의 구버전 절차를 따르며 상태를 직접 편집하지 않습니다.
제품·설계·계획·UAT 승인에서 사용자 결정을 기다립니다. 침묵은 승인이 아닙니다.

1. `superpowers:brainstorming`으로 01-brainstorm.md를 작성하고 제품 승인을 받습니다.
2. 설치된 Claude `/design` 기능을 확인하고 없으면 실제 `/claude-design` 연결을 확인합니다.
   UI가 있으면 클릭 가능한 목업과 상태·모바일 화면을 만들고 02-design.md에 구조·데이터·API·권한을
   기록합니다. 목업은 제품 소스가 아닌 docs/development/<feature>/mockup/에 보관합니다.
   WORKFLOW의 design-bundle.json으로 문서와 목업 파일을 함께 제출하고 설계 승인을 받습니다.
   UI가 없으면 non-ui 이유를 기록합니다. gstack plan-design-review는 선택적 보조 검토입니다.
3. `superpowers:writing-plans` → 첨부 기반 `qa-planning` → gstack `plan-eng-review`를 적용합니다.
   03-plan.md와 QA_PLAN-<feature>.md를 분리하고 plan-bundle.json으로 묶어 한 번에 승인받습니다.
   Task·파일 소유권·RED/GREEN·리뷰·브라우저 준비·계정·실패 시나리오·회귀·되돌리기를 확인합니다.
   이 계획 승인은 QA handoff 승인도 포함합니다. 계획 승인 전에 구현 워커를 만들지 않습니다.
4. 승인 자료를 Controller가 커밋하고 `superpowers:using-git-worktrees` 및 harness worktree로 격리합니다.
   새 체크아웃에서 진행하며 의존성 설치와 기준 검사를 수행합니다.
5. `superpowers:subagent-driven-development`와 `superpowers:test-driven-development` 규율을 적용합니다.
   구현 담당에게 계획 발췌, 정확한 cwd, 파일 소유권, QA ID, 수용 기준, 테스트 명령을 전달합니다.
   RED → GREEN → 리팩터링 및 변경 화면 자체 검증을 요구합니다. 다른 작업자의 변경을 보존합니다.
6. 구현자는 stage/commit 없이 READY_FOR_COMMIT, changed_files, proposed_commit_message를 반환합니다.
   Controller가 repository-gate → repository-commit 후 고정 base_commit..task_commit을 새 Claude
   리뷰어에게 전달합니다. Task별 및 전체 코드 리뷰는 구현에 참여하지 않은 Claude가 맡습니다.
   gstack review도 읽기 전용입니다. build 보고서에 implementation dispatch와 reviewer 메타데이터를
   기록합니다. 리뷰어는 코드를 고치지 않으며 FAIL은 구현 담당 수정 → 새 commit → 새 리뷰입니다.
7. 독립 브라우저 QA는 반드시 새 Codex 세션에 `harness-browser-qa`와 승인된 QA 계획을 전달합니다.
   구현 세션을 재사용하지 않습니다. 실제 실행 환경에서 브라우저 preflight 후 모든 활성 QA ID를
   실행하고 화면·로그·expected/actual 근거를 반환합니다. qa-only/webapp-testing은 선택적 보조 수단이며
   기본 QA 담당을 Claude로 바꾸지 않습니다. 소스·Git 변경 없이 보고서만 작성합니다.
8. 실패는 retry 후 구현 담당에게 재위임하고 commit → 리뷰 → QA → 검증을 반복합니다.
   세 차례 수정 실패 시 근거와 함께 계획 수정을 요청합니다. 실행 불가를 PASS로 처리하지 않습니다.
   `superpowers:verification-before-completion`과 harness evidence로 최신 검사를 확인하고 UAT를 받습니다.
9. UAT 후 `superpowers:finishing-a-development-branch`를 적용합니다. 기본은 브랜치 유지이며
   PR/push/merge/배포는 해당 행동에 대한 명시적 요청이 필요합니다.

## 네이티브 실행

전역 배포 원본이며 `bun run install:global`로 설치합니다. 대상 프로젝트에는 setup/configure로 연결합니다.
모든 제품 구현·테스트 작성·수정은 Codex가 수행합니다. Claude가 작은 수정도 대신하지 않습니다.
구현은 네이티브 Agent 도구의 `codex:codex-rescue`에 `--wait --fresh`를 전달하고 쓰기 가능한 작업으로
요청해 runtime의 --write 경로를 사용합니다. 실제 코드를 쓰는 주체는 Codex이며 Claude wrapper는 전달만 합니다.
TDD 규칙과 필요한 스킬 파일을 명시적으로 전달하고 Claude 스킬이 자동 상속된다고 가정하지 않습니다.
QA도 별도 codex:codex-rescue의 --wait --fresh로 실행합니다. QA 근거 파일만 쓰도록 범위를 지정합니다.
보고서 작성에는 쓰기 권한이 필요하며 제품 소스는 읽기 전용입니다. QA runtime에 브라우저 도구가
노출됐는지 preflight에서 검증합니다. wrapper 빈 출력·오류는 완료가 아닙니다.
독립 Claude 리뷰어는 별도 네이티브 Agent로 배정합니다. 자동 리뷰를 /codex:review로 대체하지 않습니다.
Codex가 불가하면 원인을 보고하며 Claude 구현/QA로 자동 대체하지 않습니다.

모든 구현 dispatch에는 다음 문장을 그대로 포함합니다:

> Do not create Git commits. Complete the implementation and verification, then return READY_FOR_COMMIT with the exact changed-file list and a proposed commit message. Repository state transitions are owned by the controller.

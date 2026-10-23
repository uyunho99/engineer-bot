---
name: development-harness-native
description: 컨트롤러가 기획·설계·계획 승인과 Git을 관리하고, 설정된 구현·리뷰·브라우저 QA 워커를 거쳐 최종 UAT까지 진행하는 개발 하네스입니다. 큰 기능은 full 트랙, 핫픽스·작은 수정은 light 트랙으로 진행합니다.
---

# 개발 책임자 (컨트롤러)

`docs/WORKFLOW.md`, `docs/REPOSITORY-CONTROL.md`, 실행 쿡북 `docs/OPERATIONS.md`를 읽습니다.
당신은 컨트롤러입니다. 사용자 대화, 승인 기록, 작업 배정, 결과 확인, Git 상태 전환을 맡고
**제품 코드와 테스트는 직접 쓰지 않습니다.** 훅이 없는 호스트에서도 같습니다. 감시자, pre-commit,
게이트가 워커 보고서로 설명되지 않는 변경을 찾아 단계를 막습니다.

## 시작

1. `~/.local/bin/development-harness status`로 진행 중인 실행을 확인하고, 있으면 재개합니다.
2. 처음 연결하는 프로젝트는 `setup` 후 실제 테스트·빌드 명령을 조사해 `configure '<JSON argv 배열>'`로 연결합니다.
   `doctor`로 이 호스트와 설정된 엔진에 필요한 것을 확인합니다.
3. 트랙을 사용자와 정합니다. 정하지 않았으면 묻습니다. 추측으로 light를 고르지 않습니다.
   - **full**: 새 기능·큰 변경. 제품 → 설계 → 계획 → UAT, 승인 4회.
   - **light**: 핫픽스·작은 수정. 계획 → UAT, 승인 2회. 설계가 필요하면 계획 번들에 함께 넣습니다.
4. `init <feature-slug> --track full|light`로 시작합니다.

## 승인 게이트

게이트에서는 사용자의 결정을 기다립니다. 침묵은 승인이 아닙니다.

- 사용자가 자신의 터미널에서 기록했으면 그대로 진행합니다.
- 사용자가 대화에서 승인·수정·취소를 **명시적으로** 말했으면, 그 발화를 원문 그대로 인용해 전달합니다.

  ```
  ~/.local/bin/development-harness decide approve --relay '<사용자 발화 원문>' '<대화 위치>'
  ```

  인용을 지어내거나 요약하지 않습니다. 모호하면 다시 묻습니다. 프로젝트가 `approval.allowRelay: false`면
  사용자에게 터미널에서 기록해 달라고 요청합니다.
- light 계획이 생각보다 크면(새 화면, 여러 모듈, 목업이 필요한 판단) 승격을 **제안**합니다. 사용자가 받아들이면
  `decide revise --escalate '<이유>'`로 full의 설계 단계로 갑니다. 트랙을 바꾸는 길은 이것 하나입니다.

## full 트랙

1. `superpowers:brainstorming`으로 `01-brainstorm.md`를 쓰고 `complete brainstorm` → 제품 승인.
2. 설계: Claude Code면 설치된 `/design` 또는 `/claude-design`, 다른 호스트면 그 호스트의 목업 수단으로
   클릭 가능한 목업과 상태·모바일 화면을 만들고 `02-design.md`에 구조·데이터·API·권한을 기록합니다.
   목업은 `docs/development/<feature>/mockup/`에 둡니다. WORKFLOW의 `design-bundle.json`으로 제출 → 설계 승인.
   UI가 없으면 non-ui 이유를 기록합니다.
3. 계획: `superpowers:writing-plans` → 첨부 기반 `qa-planning` → 설치돼 있으면 gstack `plan-eng-review`.
   `03-plan.md`와 `QA_PLAN-<feature>.md`를 `plan-bundle.json`으로 묶어 한 번에 승인받습니다.
   Task·파일 소유권·RED/GREEN·리뷰·브라우저 준비·실패 시나리오·회귀·되돌리기를 확인합니다.
   계획을 완료하는 순간 이 실행이 쓸 워커 엔진이 고정됩니다.
4. 승인 자료를 커밋하고 `worktree <절대경로> <브랜치>`를 실행합니다.
   **세션을 재시작하지 않습니다.** 실행 상태와 당신은 지금 체크아웃에 남고, 코드는 worktree에서 바뀝니다.
   출력된 안내대로 worktree를 현재 세션에 추가합니다(Claude Code는 `/add-dir`).
   의존성 설치는 백그라운드에서 시작되고 `prepare-status`로 확인합니다. 감시자와 pre-commit 상태도 출력됩니다.

## light 트랙

1. `01-brainstorm.md`에 문제·수용 기준·제외 범위·위험과 **설계가 필요한지 그 이유**를 씁니다. `complete brainstorm`(게이트 없음).
2. `03-plan.md`, `QA_PLAN-<feature>.md`, `plan-bundle.json`을 씁니다. 번들에 `"designNeeded": true|false`를 넣고,
   true면 `"design": "<설계 문서 경로>"`도 넣습니다. `complete plan` → 계획 승인.
3. 이후는 full의 4단계부터 같습니다.

## 배송 (두 트랙 공통)

1. 태스크마다 `dispatch implementer <task-id> --files <파일,...>`를 실행하고, 출력의 `invocation`대로 워커를 띄웁니다.
   - `kind: "claude-agent"`: Claude Code의 Agent 도구로 `agent`를 subagent type으로, `args`와 함께,
     `promptFile`의 내용을 프롬프트로 보냅니다. Claude Code가 아닌 호스트에서는 이 종류가 나오지 않습니다.
   - `kind: "shell"`: `command`를 `cwd`에서 그대로 실행합니다.
   워커가 어떤 엔진인지 알 필요가 없습니다. 디스패치 출력이 정합니다. 프롬프트 파일에는 워커 계약,
   역할 지시, 승인된 계획의 해당 태스크 절이 들어 있습니다. 지우거나 줄이지 않습니다.
2. 워커의 `READY_FOR_COMMIT` 보고서를 확인하고 `repository-gate <보고서> <scope>` → 결과와 diff 검토 →
   `repository-commit <token>`. 커밋하면 그 태스크의 범위는 소진됩니다. 수정 라운드는 다시 `--files`로 디스패치합니다.
3. `dispatch reviewer <task-id>`: 새 세션이 고정된 커밋 범위를 리뷰합니다. FAIL이면 구현 워커 수정 → 새 커밋 → 새 리뷰.
4. 모든 태스크 후 `complete build`, `dispatch reviewer branch` → `complete review`,
   `dispatch browserQa <id>` → `complete browser-qa`, `evidence` → `complete verification` → UAT 승인 → `complete finish`.
   브라우저 QA 워커가 codex면 `harness-browser-qa` 스킬을 씁니다.
5. 실패는 `retry '<발견 사항과 재현 방법>' --task <task-id>`로 build에 돌아갑니다. 태스크당 한도(`maxFixRounds`, 기본 5)나
   전체 한도(`maxTotalFixRounds`, 기본 15)에 닿으면 근거와 함께 계획 수정을 요청합니다. 실행 못 한 것을 PASS로 적지 않습니다.

## 가드 경고

CLI가 `⚠ … not explained by any worker report`를 띄우면 멈춥니다. 그 변경을 누가 왜 만들었는지 확인합니다.
워커가 만든 것이 맞거나 되돌렸을 때만 `guard --ack '<사실 그대로의 이유>'`로 기록합니다.
진행하려고 ack하지 않습니다. ack는 사유와 함께 최종 검증 보고에 그대로 남습니다.

## 마무리

UAT 후 `superpowers:finishing-a-development-branch`를 적용합니다. 기본은 브랜치 유지입니다.
PR·push·merge·배포는 사용자가 그 행동을 명시적으로 요청해야 합니다. UAT 승인만으로는 생기지 않습니다.

## 지키는 것

- `.harness/state.json`을 직접 고치지 않습니다.
- 워커의 실패나 빈 출력은 완료가 아닙니다. 원인을 보고하고, 컨트롤러가 대신 구현하지 않습니다.
- 구버전 실행(workflowVersion이 없거나 상태가 worktree 안에 있는 실행)은 그 방식대로 완주합니다.

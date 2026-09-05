# 워커 실행 규약

`CLAUDE.md`와 `docs/OPERATIONS.md`를 읽습니다. 워커는 현재 유효한 Orca 주입 Task에만 따라 작업합니다.
중첩 에이전트와 codex-plugin-cc를 사용하지 않습니다. Task 명세에서 소유권을 부여한 경로만 다루고
다른 작업자의 변경을 되돌리지 않습니다. 구현 담당은 TDD를 사용합니다. 리뷰·QA 담당은 보고서를
작성할 수 있지만 소스는 수정하지 않습니다. 하네스 상태는 코디네이터만 전환합니다. 워커는
`harness complete`나 `harness decide`를 실행하지 않습니다.

자신의 pane에서 `taskId`, `dispatchId`, `verdict`, `reportPath`를 포함한 `worker_done`을 한 번만 보낸 뒤
대기합니다. 오래된 preamble은 실행 권한이 아닙니다. 작업이 막히면 코디네이터에게 질문합니다.

# engineer-bot — Orca 오케스트레이션

규모가 있는 소프트웨어 작업에는 `.claude/skills/development-harness-orca/SKILL.md`를 사용합니다.
Main Claude가 사용자 대화, 기획 산출물, 승인 게이트를 맡습니다. 구현, 수정, 독립 리뷰, QA는 모두
추적 가능한 Orca 워커 배정으로 실행합니다. Claude와 Codex 워커는 설치된 Superpowers와 gstack의
개발 규율을 적용합니다. 네이티브 하위 에이전트를 중첩해서 만들거나 추적 대상 작업에
codex-plugin-cc를 사용하지 않습니다. 리뷰 담당에게는 애플리케이션 읽기 권한만 부여합니다.

세션마다 설치된 Orca 가이드를 읽습니다. `run-create`나 `worker-start`가 있다고 가정하지 않습니다.
지속 상태, 네 차례의 필수 승인, 복구 방법은 `docs/OPERATIONS.md`를 따릅니다. 승인 게이트를 우회하거나,
승인을 만들어내거나, 본문에 적힌 `PASS`만으로 성공을 판단하거나, 관련 없는 변경을 덮어쓰면 안 됩니다.

Repository Control Layer는 Controller가 소유합니다. 공통 규칙과 보고서 계약은
[docs/REPOSITORY-CONTROL.md](docs/REPOSITORY-CONTROL.md)를 따릅니다.
구현 워커는 stage/commit/merge 없이 검증된 변경과 `READY_FOR_COMMIT` 보고서를 반환합니다.

## 목업과 독립 QA

[WORKFLOW.md](docs/WORKFLOW.md)의 새 계약을 적용합니다. Claude 디자인 목업 → writing-plans →
qa-planning → plan-eng-review → 구현 → Controller commit → 새 Claude 코드 리뷰 → 새 Codex 브라우저 QA 순서입니다.
설계·계획은 관련 파일 해시를 묶어 승인합니다. QA는 실제 브라우저 실행과 모든 승인 시나리오의 근거가 필요합니다.

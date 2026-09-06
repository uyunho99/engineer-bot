# engineer-bot — Claude 네이티브

이 저장소는 전역 하네스의 배포 원본입니다. 여러 프로젝트 사용 절차는 README를 따릅니다.
전역 설치는 `bun run install:global`, 하네스 자체 검증은 `bun run check`와 `bun run build`입니다.
대상 프로젝트에서는 `~/.local/bin/development-harness` 명령을 사용하며 이 저장소의 소스를 복사하지 않습니다.

규모가 있는 소프트웨어 작업에는 `.claude/skills/development-harness-native/SKILL.md`를 사용합니다.
Main Claude는 기획·관리·리뷰를 맡고 모든 구현·테스트 작성·리팩터링·버그 수정은
`codex:codex-rescue`를 통해 Codex에 위임합니다. Claude 구현 에이전트를 만들거나 직접 소스를
수정하지 않습니다. Codex 실행 실패 시 중단하며 Claude로 대체하지 않습니다. 제품, 설계, 구현·QA 통합 계획, 최종 UAT
승인 게이트는 필수입니다. 명령어는 `docs/OPERATIONS.md`에서 확인합니다.

계획 승인과 독립 worktree 준비 전에는 애플리케이션 코드를 수정하지 않습니다. 리뷰 담당은 보고서만
작성합니다. Hook을 우회하거나 사용자 결정, 명령 실행 근거, 리뷰 결과를 만들어내면 안 됩니다.
사용자가 범위를 명시적으로 바꾸면 그 결정을 기록하고 진행합니다. 승인 게이트를 조용히 생략하지 않습니다.
이 브랜치에는 Orca 스케줄러가 없습니다. SDD가 끝났다는 이유만으로 전체 실행을 완료하지 않습니다.

Repository Control Layer는 Controller가 소유합니다. 공통 규칙과 보고서 계약은
[docs/REPOSITORY-CONTROL.md](docs/REPOSITORY-CONTROL.md)를 따릅니다.
구현 워커는 stage/commit/merge 없이 검증된 변경과 `READY_FOR_COMMIT` 보고서를 반환합니다.

## 목업과 독립 QA

[WORKFLOW.md](docs/WORKFLOW.md)의 새 계약을 적용합니다. Claude 디자인 목업 → writing-plans →
qa-planning → plan-eng-review → 구현 → Controller commit → 새 Claude 코드 리뷰 → 새 Codex 브라우저 QA 순서입니다.
설계·계획은 관련 파일 해시를 묶어 승인합니다. QA는 실제 브라우저 실행과 모든 승인 시나리오의 근거가 필요합니다.

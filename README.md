# engineer-bot — orca-orchestration

설치된 Orca, Claude·Codex 워커, Superpowers, gstack을 사용하는 독립적인 감독형 개발 하네스입니다.
제품, 설계, 구현·QA 통합 계획, UAT 승인 게이트는 필수입니다.
추적 대상 작업에는 codex-plugin-cc를 사용하지 않습니다.

```bash
bun install --frozen-lockfile
bun run check
bun run smoke
bun run build
bun run harness doctor
```

이 체크아웃을 Orca에서 열고 Claude를 시작한 뒤 `/development-harness-orca`를 실행하거나 기능 구현을
요청하세요. 전체 운영 흐름과 복구 방법은 [운영 쿡북](docs/OPERATIONS.md)에서 확인할 수 있습니다.

**설치된 실행 규약:** 현재 Orca는 `run`, `task-create`, `dispatch`, `check`, 게이트 명령을 제공하지만
`run-create`와 `worker-start`는 제공하지 않습니다. 하네스는 지원되는 수동 배정 루프를 사용하며,
최상위 Task를 추적 가능한 실행 컨테이너로 사용합니다. 사용자 승인 게이트를 우회할 수 있는 기존 자동
`run` 스케줄러는 실행하지 않습니다. 명령 규약이 달라지면 어댑터를 검토할 때까지 안전하게 중단합니다.
두 하네스는 같은 기준 커밋에서 만든 독립 브랜치이며 서로 merge하지 않습니다.

Repository Control Layer는 Controller가 소유합니다. 공통 규칙과 보고서 계약은
[docs/REPOSITORY-CONTROL.md](docs/REPOSITORY-CONTROL.md)를 따릅니다.
구현 워커는 stage/commit/merge 없이 검증된 변경과 `READY_FOR_COMMIT` 보고서를 반환합니다.

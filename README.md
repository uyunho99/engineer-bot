# engineer-bot v2

Orca를 유일한 scheduler로 쓰는 Claude Code · Codex 자동 개발팀입니다.

```text
요청 → Claude Lead Router → gstack 기획 → Superpowers 개발 규율
     → Orca Task DAG → Codex 구현 → Claude 리뷰 → Codex 수정 → Claude QA·최종 검증
```

| 역할 | 런타임 | 쓰기 권한 |
|---|---|---|
| Lead Router | Claude Code | 없음 |
| Implementer / Fixer | Codex | 배정된 경로만 |
| Reviewer / QA / Final verifier | Claude Code | 없음 |
| Scheduler | Orca | Task·dispatch·gate의 단일 소유자 |

gstack과 Superpowers는 설치되어 있어야 합니다. 두 도구의 기획·TDD·디버깅·검증 규율은 각 역할의 프롬프트에서 사용합니다. 내부 에이전트 생성은 호출하지 않습니다. 워커 생성·대기·결정은 Orca `task-create`, `dispatch --inject`, `check --wait`, `ask/reply`, `gate-create/gate-resolve`만 사용합니다.

## 시작

```bash
orca status --json
orca skills get orchestration --full
bun run plan -- --request "팀 초대 기능을 추가하고 테스트를 작성해"
bun run smoke
bun run check
```

기본 명령은 안전한 `--dry-run`입니다. 실제 실행 전 `orca terminal list --json`으로 세 역할의 handle을 확인합니다. 이후 아래처럼 실행하면 coordinator가 태스크 생성, injected dispatch, review/fix/QA loop를 감독합니다.

```bash
bun run src/cli.ts plan --execute --request "팀 초대 기능을 추가해" \
  --lead <claude-lead-handle> --codex <codex-handle> --reviewer <claude-reviewer-handle>
```

Orca runtime이 꺼져 있거나 역할 handle이 빠졌으면 실행하지 않고 명확히 실패합니다.

운영 규칙은 [docs/OPERATIONS.md](docs/OPERATIONS.md), 역할 프롬프트는 [skills](skills)에 있습니다. 이전 planner/builder 하네스는 Git `legacy` 브랜치에 보존됩니다.

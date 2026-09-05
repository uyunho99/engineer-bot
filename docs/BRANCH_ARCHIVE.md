# 브랜치 보관 기록 — 2026-09-05

## 유지하는 브랜치

| 브랜치 | 용도 |
|---|---|
| `claude-only` | GitHub 기본 브랜치. Claude Code 네이티브 하네스 |
| `orca-orchestration` | Orca 실행 규약을 사용하는 독립 하네스 |
| `legacy` | 기존 planner/builder 하네스의 마지막 통합 상태 |

이번 정리는 브랜치를 merge하지 않습니다. 기존 두 하네스의 커밋도 변경하지 않습니다.

## legacy 선정 근거

보존 기준 커밋은 `99a86df8c56c1bee03c6a3803db8cce85c1488d3`입니다.
이 커밋은 `master`, `feature/plan-preflight`, `feature/harness-b6-export`,
`feature/preflight-cluster`, `fix/d28-raw-write`의 로컬 끝 커밋을 모두 조상으로 포함합니다.

원격 preflight-cluster는 `d104dd6`에서 멈췄지만 로컬은 `a9ebb5a`까지 12커밋 더 진행됐습니다.
두 지점을 각각 태그로 보존합니다. 마지막 기획 검사 자료까지 포함한 `99a86df`를 legacy 기준으로 선택했습니다.

더 늦게 작성된 `orca-autonomous-v2` (`b64004c`)는 기존 컨트롤러와 오버레이를 대체한 별도 구현입니다.
이 상태는 두 최신 하네스의 공통 조상에 이미 포함되어 있으며 별도 태그로도 남깁니다.
따라서 기존 planner/builder 소스를 보존하는 legacy는 대체 직전 상태를 사용합니다.

## 검증 결과

분리된 임시 worktree에서 소스 수정 없이 다음 명령을 실행했습니다.

- `bun install --frozen-lockfile`: 통과.
- `bun run check`: TypeScript 타입 검사, 테스트 399개(실패 0개, 단언 650개), `./bootstrap.sh check` 모두 통과.
- 기존 변경이 legacy에 포함되는지는 `git merge-base --is-ancestor`로 확인했습니다.

이 결과는 실제 모델을 사용한 전체 개발·배포의 완성을 뜻하지 않습니다.
README의 수동 1회전, Slack 인바운드, 배포·운영 미완료 상태는 그대로 보존합니다.

## 보존 태그

| 원래 브랜치 / 참조 | 끝 커밋 | 보존 태그 |
|---|---|---|
| `master` | `0f00cf6` | `archive/2026-09-05/master` |
| `feature/plan-preflight` | `359e643` | `archive/2026-09-05/feature/plan-preflight` |
| `feature/harness-b6-export` | `fd76b58` | `archive/2026-09-05/feature/harness-b6-export` |
| `feature/preflight-cluster` | `a9ebb5a` | `archive/2026-09-05/feature/preflight-cluster` |
| `fix/d28-raw-write` | `2badf65` | `archive/2026-09-05/fix/d28-raw-write` |
| `orca-autonomous-v2` | `b64004c` | `archive/2026-09-05/orca-autonomous-v2` |
| `claude/project-goals-status-91462c` | `0f00cf6` | `archive/2026-09-05/claude/project-goals-status-91462c` |
| `legacy (정리 전 원본)` | `99a86df` | `archive/2026-09-05/legacy-baseline` |
| `origin/feature/preflight-cluster` | `d104dd6` | `archive/2026-09-05/origin/feature/preflight-cluster` |

## 관련 PR과 worktree

옛 브랜치에 남아 있던 PR #2, #3, #4는 이번 보관 정리에 따라 merge 없이 닫습니다.
각 PR의 변경 이력은 GitHub에 남으며, 브랜치 끝 커밋도 위 태그로 복구할 수 있습니다.

기존 `claude/project-goals-status-91462c` worktree는 파일과 커밋을 보존한 채 detached HEAD로 전환합니다.
원래 저장소 폴더 `engineer-bot`은 legacy를 체크아웃하고, 두 최신 하네스는 기존의 독립 worktree에서 유지합니다.

## 복구 방법

보존 태그를 기준으로 새 브랜치를 만들 수 있습니다. 아래는 예시입니다.

```bash
git fetch origin --tags
git switch -c restore/preflight-cluster archive/2026-09-05/feature/preflight-cluster
```

원격 당시의 preflight-cluster 상태가 필요하면 `archive/2026-09-05/origin/feature/preflight-cluster`를 사용합니다.

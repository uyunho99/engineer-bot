# Discoveries — feature/plan-preflight

builder 세션이 누적한다. SDD 워크스페이스는 최종 리뷰 후 삭제되므로 여기 쌓는다 (A5).
형식: `- [<task-id>] <한 줄 발견> — <왜 다음 태스크에 영향을 주는가>`

## 2026-09-03 · 1회전 (BLOCKED, Task 1 착수 전)

- [setup] **세션이 `bun`·`git add`·`npm` 을 실행할 수 없었다** — Bash 가 읽기 전용
  허용목록으로 제한돼 있었다. `pwd`·`git status`·`ls`·`find`·`which` 는 통과하고
  테스트 러너와 git 쓰기는 전부 `This command requires approval` 로 거부됐다.
  15개 태스크가 전부 `verification=deterministic` 이라 RED→GREEN 관찰이 필수인데,
  그 관찰을 만들 수단이 없으므로 어떤 태스크도 완료 판정을 받을 수 없다.
- [setup] **서브에이전트도 같은 제한을 받는다** — haiku 프로브를 띄워 `bun test` 를
  시켰더니 동일하게 거부됐다. 권한은 컨트롤러 세션 로컬이 아니라 세션 전체에 걸린다.
  즉 "권한 있는 서브에이전트에게 시킨다"는 우회는 존재하지 않는다.
- [setup] **superpowers 의 `scripts/sdd-workspace`·`task-brief`·`review-package` 를
  실행할 수 없다** — 샌드박스가 세션을 프로젝트 디렉터리로 가두는데, 그 스크립트들은
  `~/.claude/plugins/cache/…` 에 있다. RUN.md 가 기록한 `--add-dir` 버그와 같은 계열의
  문제다: **하네스가 외부 프로세스·외부 경로에 의존하는 지점은 단위 테스트가 닿지 않고,
  실제 세션에서만 드러난다.** `bin/builder` 가 세션을 띄울 때 권한 모드와 `--add-dir`
  대상을 명시적으로 검증하는 프리플라이트가 필요하다는 신호다.
- [plan] **Task 3 의 네 번째 "테스트로 증명할 것" 항목은 단위 테스트가 아니다** —
  `PreflightDefect["task_ids"]` 튜플 강제는 `bun run typecheck` 로만 관찰된다.
  계획서가 그 한계를 명기하고 있으므로 결함이 아니지만, Task 3 리뷰어가 "assert 없는
  테스트"로 오인할 수 있다. 디스패치에 미리 알려야 한다.
- [plan] **Task 11 의 예시 `controller/preflight-cli.ts` 는 `findFixSites` 를
  import 하고 쓰지 않는다** — `tsconfig.json` 의 `noUnusedLocals: true` 때문에
  그대로 옮기면 Task 11 Step 4 의 `bun run typecheck` 가 실패한다. 전사할 때
  그 import 를 빼야 한다. 계획서의 코드 블록과 통과 기준이 충돌하는 것이 아니라,
  통과 기준이 전사 세부를 지배하는 경우다.

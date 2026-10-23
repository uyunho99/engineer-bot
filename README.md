# engineer-bot — 개발 하네스

기획부터 UAT까지 사람 승인 게이트를 두고, 구현·리뷰·브라우저 QA를 각각 새 세션의 워커에게 맡기는
개발 하네스입니다. **컨트롤러는 기획·승인 기록·작업 배정·Git을 맡고 제품 코드를 쓰지 않습니다.**
컨트롤러는 Claude Code, Codex, Gemini CLI 중 하나이고, 워커 엔진은 역할마다 설정합니다.

```text
full  : 기획 → [제품 승인] → 설계 → [설계 승인] → 계획 → [계획 승인] → worktree → 구현 → 리뷰 → 브라우저 QA → 검증 → [UAT] → 완료
light : 기획 →                                    계획 → [계획 승인] → worktree → 구현 → 리뷰 → 브라우저 QA → 검증 → [UAT] → 완료
```

큰 기능은 full, 핫픽스와 작은 수정은 light로 시작합니다. light 계획이 커지면 계획 승인에서 full로 올립니다.

## 전역 설치 — 한 번만 실행

```bash
git clone https://github.com/uyunho99/engineer-bot.git engineer-bot
cd engineer-bot
git switch harness/controller-managed-git
bun install --frozen-lockfile
bun run install:global
```

이 하네스가 저장소의 기본 브랜치가 되면 `git switch`는 생략합니다. 그 전에 기본 브랜치에서 설치하면
더 오래된 하네스가 설치됩니다. 이 버전부터는 설치기가 설치된 버전을 기록하고, 더 낮은 버전으로 덮어쓰려 하면
`--force` 없이는 거부합니다.

컨트롤러로 쓸 호스트를 고릅니다. 여러 개를 함께 설치할 수 있고 CLI는 하나를 공유합니다.

```bash
bun run install:global --host claude-code
bun run install:global --host codex
bun run install:global --host gemini
```

| 무엇이 | 어디에 |
|---|---|
| CLI·hook·역할 지시·문서 | `~/.local/share/development-harness/` (호스트와 무관하게 하나) |
| 실행 명령 | `~/.local/bin/development-harness` |
| Claude Code 컨트롤러 스킬 | `~/.claude/skills/development-harness-native/`, `~/.claude/settings.json`의 hook |
| Codex 컨트롤러 스킬 | `~/.codex/skills/development-harness/` |
| Gemini CLI 컨트롤러 스킬 | `~/.gemini/skills/development-harness/` |

`--host codex`나 `--host gemini`만 설치하면 `~/.claude/`를 건드리지 않습니다.
Antigravity는 아직 지원하지 않습니다. 스킬을 읽는 위치와 비대화 실행 방법이 확인되지 않았습니다.

## 엔진 설정

설정이 없으면 Claude Code 컨트롤러 아래에서 구현·리뷰·QA가 모두 codex-plugin-cc의 `codex:codex-rescue`로 돕니다.
바꾸려면 `~/.config/development-harness/agents.json`(내 기본값) 또는 프로젝트 `harness.config.json`(프로젝트 덮어쓰기)에 적습니다.

```json
{
  "controller": { "host": "claude-code" },
  "agents": {
    "implementer": { "engine": "codex", "dispatch": { "kind": "claude-agent", "agent": "codex:codex-rescue", "args": ["--wait", "--fresh", "--write"] } },
    "reviewer":    { "engine": "claude", "dispatch": { "kind": "claude-agent", "agent": "general-purpose", "readOnly": true } },
    "browserQa":   { "engine": "codex", "dispatch": { "kind": "shell", "command": ["codex", "exec", "-s", "workspace-write", "-C", "{{cwd}}", "{{prompt}}"] } }
  },
  "requireCrossEngineReview": true
}
```

자세한 설명은 [쿡북의 엔진·호스트 설정](docs/OPERATIONS.md#엔진호스트-설정)에 있습니다.

## 매 프로젝트에서 시작하기

개발할 프로젝트에서 컨트롤러를 실행하고 스킬을 부릅니다. Claude Code라면:

```bash
cd /path/to/your-project
claude
```

```text
/development-harness-native
[만들고 싶은 기능 또는 고칠 문제]
light로 진행해줘.
```

컨트롤러가 첫 실행에 `setup`과 `configure`로 프로젝트를 연결합니다. 기존 소스, package.json, CLAUDE.md는
복사하거나 덮어쓰지 않습니다. 프로젝트에는 `harness.config.json`, `.gitignore`의 `.harness/` 항목,
진행 상태 `.harness/`, 기획·검증 문서 `docs/development/`가 생깁니다.

승인은 두 가지로 기록됩니다. 자신의 터미널에서 직접 실행하거나, 대화에서 명시적으로 승인하면
컨트롤러가 그 발화를 원문 그대로 인용해 `--relay`로 기록합니다. 전달 승인은 상태와 최종 보고에 따로 표시되고,
프로젝트에서 `approval.allowRelay: false`로 끌 수 있습니다.

worktree를 만들어도 세션을 다시 시작하지 않습니다. 실행 상태는 원래 체크아웃에 남고 코드는 worktree에서 바뀝니다.

### 직접 설정하거나 상태 확인하기

```bash
~/.local/bin/development-harness setup
~/.local/bin/development-harness configure '[["npm","test"],["npm","run","build"]]'
~/.local/bin/development-harness status
~/.local/bin/development-harness doctor
```

셸 구문이 필요한 검증 명령은 `["sh", "-c", "실제 명령"]` 형태로 적습니다.

## 설치 문제 해결

- `development-harness` 명령 없음: `~/.local/bin/development-harness` 전체 경로로 실행하세요. 설치기는 PATH를 바꾸지 않습니다.
- 스킬이 안 보임: 설치 후 컨트롤러 호스트를 재시작하세요. `doctor`가 선언된 호스트의 스킬 위치를 알려 줍니다.
- 다운그레이드 거부: 더 오래된 체크아웃에서 설치하고 있습니다. 의도한 것이면 `--force`를 붙입니다.
- 검증 명령 없음: 계획 승인 전에 `configure`로 실제 명령을 설정하세요. 임의 기본 명령으로 성공 처리하지 않습니다.

## 하네스 자체 검증

```bash
bun run check
bun run smoke
bun run build
```

[운영 쿡북](docs/OPERATIONS.md)에 명령, 상태와 근거 관리, 가드, 복구가 있습니다.
[컨트롤러 스킬](.claude/skills/development-harness-native/SKILL.md)은 컨트롤러가 읽는 실행 지침이고,
[역할 지시](agents/common/)는 디스패치가 워커 프롬프트에 넣는 지침입니다.
[저장소 제어 정책](docs/REPOSITORY-CONTROL.md)과 [목업·계획·독립 검증 계약](docs/WORKFLOW.md)을 함께 따릅니다.

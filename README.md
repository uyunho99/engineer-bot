# engineer-bot — claude-only

설치된 Superpowers, gstack, codex-plugin-cc를 사용하는 독립적인 Claude Code 네이티브
개발 하네스입니다. **Claude는 기획·관리·리뷰 결과 취합, Codex는 코드 구현·TDD·수정과 별도 세션의 독립 리뷰·QA**을 맡습니다.
Main Claude가 네 차례의 사용자 승인과 Codex 작업 위임·검증을 조율합니다.
`claude-only`는 Orca 없이 Claude가 관리한다는 뜻이며, Claude가 코드를 구현한다는 뜻이 아닙니다.
Codex 실행이 실패하면 중단하며 Claude 구현으로 대체하지 않습니다.

```text
기획 → 제품 승인 → 설계 → 설계 승인 → 구현 계획 + QA 계획
→ 계획 승인 → worktree → TDD → 리뷰 → 브라우저 QA → 검증 → 최종 UAT → 완료
```

## 전역 설치 — 한 번만 실행

여러 프로젝트에서 사용할 때는 하네스 저장소를 한 번만 받아 전역 설치합니다.
이미 `claude-only` 폴더가 있다면 clone을 생략하고 그 폴더에서 설치하세요.

```bash
git clone --branch claude-only --single-branch https://github.com/uyunho99/engineer-bot.git engineer-bot
cd engineer-bot
bun install --frozen-lockfile
bun run install:global
```

설치기는 사용자 Claude 스킬 폴더에 실행 코드를 번들로 복사하고,
`~/.local/bin/development-harness` 명령을 만듭니다. 기존 Claude 설정은 보존하며
백업을 남긴 뒤 전역 hook과 Codex 플러그인 활성화 설정을 추가합니다.
원본 저장소를 이동해도 설치된 실행 코드는 동작합니다. 업데이트는 이 설치 명령을 다시 실행합니다.

Git, Bun, Claude Code, Codex CLI, Superpowers, gstack, codex-plugin-cc가 필요합니다.
Bun은 하네스 실행에 사용하며 대상 프로젝트의 npm·pnpm·Python 등은 그대로 사용할 수 있습니다.
`bun install`은 플러그인이나 로그인을 설치하지 않습니다. Codex 플러그인을 프로젝트 범위로만
설치했다면 사용자 범위에도 설치하세요.

```bash
claude plugin install codex@openai-codex --scope user
~/.local/bin/development-harness doctor
```

`doctor`는 로컬 의존성을 확인하며 모델 호출이나 로그인 성공까지 검증하지는 않습니다.
다른 의존성 설정은 [쿡북](docs/OPERATIONS.md#설치-정보와-적용-범위)을 참고하세요.

## 매 프로젝트에서 시작하기

**개발할 프로젝트 폴더**로 이동해 Claude Code를 새로 실행합니다.

```bash
cd /path/to/your-project
claude
```

```text
/development-harness-native
[만들고 싶은 프로젝트 또는 기능 설명]
기획부터 진행해줘.
```

Claude가 첫 실행에 전역 명령의 `setup`을 실행하고 실제 빌드·테스트 명령을 조사해
`configure`로 연결합니다. 기존 소스, package.json, CLAUDE.md를 복사하거나 덮어쓰지 않습니다.
프로젝트에는 `harness.config.json`, `.gitignore`의 `.harness/` 항목,
진행 상태 `.harness/`, 기획·검증 문서 `docs/development/`가 생성됩니다.
Hook은 `mode: claude-only` 설정이 있는 프로젝트에만 적용됩니다.

새 프로젝트라면 원하는 폴더에서 `git init`으로 저장소를 만들고, 초기 커밋 후 하네스 실행을
시작합니다. engineer-bot의 코드·이력·원격 저장소를 프로젝트마다 clone할 필요가 없습니다.

기획 → 제품 승인 → 설계 → 설계 승인 → 구현·QA 계획 → 계획 승인 후 별도 worktree에서 개발합니다.
사용자는 각 승인 지점에서 안내받은 `~/.local/bin/development-harness decide` 명령을
자신의 터미널에서 실행합니다. 최종 검증과 UAT 후 브랜치를 유지합니다.

### 직접 설정하거나 상태 확인하기

아래 검증 명령은 예시입니다. 프로젝트에서 실제로 사용하는 명령으로 바꾸세요.
셸 구문이 필요한 명령은 `["sh", "-c", "실제 명령"]` 형태로 명시합니다.

```bash
~/.local/bin/development-harness setup
~/.local/bin/development-harness configure '[["npm","test"],["npm","run","build"]]'
~/.local/bin/development-harness status
```

진행 중이면 Claude에 기존 작업을 이어달라고 요청하세요.
완료된 실행 보관은 [쿡북](docs/OPERATIONS.md#상태-파일과-보관-위치)을 참고하세요.

## 설치 문제 해결

- `package.json` 없음: `bun install`은 하네스 원본 저장소에서 한 번 실행합니다. 다른 프로젝트에 하네스 설치 목적으로 실행하지 않습니다.
- `development-harness` 명령 없음: `~/.local/bin/development-harness` 전체 경로로 실행하세요. 설치기는 셸의 PATH 설정을 변경하지 않습니다.
- 스킬이 안 보임: 전역 설치 후 Claude Code를 재시작하세요. 현재 공식 문서상 같은 이름이면 개인 스킬이 프로젝트 스킬보다 우선합니다. `/development-harness-native`가 전역 지침을 읽는지 확인하세요.
- 검증 명령 없음: 계획 승인 전에 `configure`로 실제 테스트·빌드 명령을 설정하세요. 임의 기본 명령으로 성공 처리하지 않습니다.

## 하네스 자체 검증

```bash
bun run check
bun run smoke
bun run build
```

Claude에게 기능 구현을 요청하거나 `/development-harness-native`를 실행하세요.
[운영 쿡북](docs/OPERATIONS.md)에서 설치, 운영 명령, 상태와 근거 관리, 복구, 다른 저장소에서의
재사용 방법을 확인할 수 있습니다. [하네스 스킬](.claude/skills/development-harness-native/SKILL.md)은
에이전트가 읽는 전체 실행 지침입니다. 기본 완료 동작은 브랜치를 유지하며 자동으로 merge하지 않습니다.

Repository Control Layer는 Controller가 소유합니다. 공통 규칙과 보고서 계약은
[docs/REPOSITORY-CONTROL.md](docs/REPOSITORY-CONTROL.md)를 따릅니다.
구현 워커는 stage/commit/merge 없이 검증된 변경과 `READY_FOR_COMMIT` 보고서를 반환합니다.

## 목업과 독립 QA

[WORKFLOW.md](docs/WORKFLOW.md)의 새 계약을 적용합니다. Claude 디자인 목업 → writing-plans →
qa-planning → plan-eng-review → 구현 → Controller commit → 새 Codex 코드 리뷰 → 새 Codex 브라우저 QA 순서입니다.
설계·계획은 관련 파일 해시를 묶어 승인합니다. QA는 실제 브라우저 실행과 모든 승인 시나리오의 근거가 필요합니다.

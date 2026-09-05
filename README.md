# engineer-bot — claude-only

설치된 Superpowers, gstack, codex-plugin-cc를 사용하는 독립적인 Claude Code 네이티브
개발 하네스입니다. Main Claude가 네 차례의 사용자 승인과 구현·리뷰 에이전트를 조율합니다.

```text
기획 → 제품 승인 → 설계 → 설계 승인 → 구현 계획 + QA 계획
→ 계획 승인 → worktree → TDD → 리뷰 → 브라우저 QA → 검증 → 최종 UAT → 완료
```

## 새 프로젝트 시작하기

`claude-only` 브랜치를 새 폴더에 clone한 뒤 **그 폴더 안에서** 설치합니다.
`my-project`는 원하는 폴더 이름으로 바꾸세요.

필요한 도구는 Git, Bun, Claude Code, Codex CLI, Superpowers, gstack,
codex-plugin-cc입니다. `bun install`은 저장소의 패키지 의존성만 설치하며,
Claude 플러그인이나 로그인까지 설정하지는 않습니다.
플러그인 설정은 [쿡북](docs/OPERATIONS.md#설치-정보와-적용-범위)을 참고하세요.

```bash
git clone --branch claude-only --single-branch https://github.com/uyunho99/engineer-bot.git my-project
cd my-project
bun install --frozen-lockfile
bun run harness doctor
claude
```

`doctor`가 오류 없이 끝나면 필요한 로컬 도구 확인을 통과한 것입니다.
로그인이나 실제 모델 호출 성공까지 검증하는 명령은 아닙니다.
Claude가 열리면 다음과 같이 요청하세요.

```text
/development-harness-native
[만들고 싶은 프로젝트 또는 기능 설명]
기획부터 진행해줘.
```

Main Claude가 기획, 설계, 구현·QA 계획을 작성하고 각각 사용자 승인을 받습니다.
현재 승인 방식은 사용자가 자신의 터미널에서 안내된 `bun run harness decide`
명령을 실행하는 방식입니다. 계획 승인 후 별도 worktree를 만들면 안내된 경로로
이동해 개발을 이어갑니다. 최종 검증 뒤에는 사용자 UAT 승인을 받고 브랜치를 유지합니다.

### 독립 프로젝트의 Git 원격 저장소 설정

Clone에는 engineer-bot의 코드와 Git 이력이 포함되며, `origin`도 engineer-bot을
가리킵니다. 빈 앱 템플릿을 생성하는 명령은 아닙니다. 독립 프로젝트로 사용할 때는
push하기 전에 GitHub 등에서 새 저장소를 만들고 `origin`을 변경하세요.
아래 URL은 실제 새 저장소 주소로 바꿔 실행합니다.

```bash
git remote set-url origin https://github.com/YOUR_ACCOUNT/YOUR_NEW_REPOSITORY.git
git remote -v
```

이 명령은 원격 주소만 바꾸며 기존 Git 이력은 유지합니다. Push는 별도로 실행합니다.

### 이미 clone한 폴더에서 다시 시작하기

해당 폴더로 이동해 `bun run harness doctor`를 실행한 다음 `claude`를 여세요.
이미 진행 중인 작업이 있다면 새 작업을 만들지 말고 기존 작업을 이어달라고 요청하세요.
`bun run harness status`로 진행 상태를 확인할 수 있습니다.
완료된 실행의 보관과 새 실행 시작 방법은 [쿡북](docs/OPERATIONS.md#상태-파일과-보관-위치)에 있습니다.

## 기존 개발 프로젝트에 적용하기

다른 프로젝트에는 `/development-harness-native`만 입력해서 사용할 수 없습니다.
이 스킬과 실행 코드는 **프로젝트 안에 설치**되어 있습니다.

- 기존 Superpowers·gstack 등 공용 설치는 재사용할 수 있습니다.
- 대상 프로젝트에 하네스 스킬, 실행 코드, 설정과 package 스크립트를 연결해야 합니다.
- `CLAUDE.md`와 Claude hook은 기존 설정을 보존하면서 병합해야 합니다.
- 검증 명령은 대상 프로젝트의 실제 빌드·테스트 명령에 맞춰야 합니다.

기존 `src`나 `package.json`을 통째로 덮어쓰지 마세요.
현재는 다른 저장소에 자동으로 연결하는 설치기를 제공하지 않습니다.
자세한 범위는 [재사용 안내](docs/OPERATIONS.md#검증과-재사용)를 참고하세요.

## 설치 문제 해결

`Bun could not find a package.json` 또는 `Script not found "harness"`가 나오면
현재 폴더를 확인하세요. 홈 폴더(`~`)가 아니라 clone한 프로젝트 폴더에서 실행해야 합니다.
이 오류를 해결하려고 홈 폴더에서 `bun init`을 실행할 필요는 없습니다.

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

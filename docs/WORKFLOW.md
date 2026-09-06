# 목업·계획·독립 검증 계약

## 역할과 순서

| 단계 | 담당 | 적용 기능 |
|---|---|---|
| 기획 | Main Claude | Superpowers brainstorming → 제품 승인 |
| 설계·목업 | Main Claude / Claude Design | 실제 설치된 `/design` 또는 `/claude-design` → 설계 승인 |
| 구현 계획 | Main Claude | writing-plans |
| QA 계획 | Main Claude | 첨부 원본에서 가져온 qa-planning |
| 계획 검토 | Main Claude | plan-eng-review로 구현·QA 실행 가능성 검토 → 계획 승인 |
| worktree | Controller | using-git-worktrees |
| 구현·자체 확인 | Codex (Orca는 Claude 구현 워커도 허용) | TDD + 변경한 화면의 브라우저 자체 검증 |
| Git | Controller | repository-gate → repository-commit |
| 독립 코드 리뷰 | 새로운 Claude 리뷰어 | 명세 준수·품질, gstack review를 읽기 전용으로 적용 |
| 독립 브라우저 QA | 새로운 Codex QA 워커 | harness-browser-qa + 실제 브라우저 도구 |
| 검증·UAT | Controller / 검증 담당 → 사용자 | verification-before-completion |
| 마무리 | Controller | finishing-a-development-branch, 기본 브랜치 유지 |

모델 버전은 고정하지 않고 실행 환경 설정을 따른다. 구현 세션을 QA에 재사용하지 않는다.
코드 리뷰와 브라우저 QA는 코드를 고치지 않는다. 실패는 구현 워커로 반환하고 Controller가
수정 커밋을 만든 뒤 새 SHA에서 리뷰·QA·검증을 반복한다. Repository Control 정책도 함께 적용한다.
gstack plan-design-review와 qa-only는 선택적 보조 검사이며 필수 의존성이 아니다.

## 설계: 실제 목업을 승인

`/design`을 이름만 보고 내장 명령이라고 가정하지 않는다. 설치된 명령/스킬/Claude Design 연결을
확인하고 실제 호출 이름을 기록한다. 현재 사용자 설치에는 `/claude-design`이 확인되었다.
Claude Design 목업은 승인된 제품 범위만 전달해 작성한다. 공유·공개 배포는 별도 요청 없이는 하지 않는다.
정상·로딩·빈 화면·오류·권한 부족 상태, 모바일, 주요 전환을 목업에 포함한다.
제품 구현과 목업을 구분한다. Claude는 `docs/development/<feature>/mockup/`에 목업을 작성/보관할 수 있다.
제품 소스는 구현 단계의 워커가 맡는다. URL만 남기면 원격 편집으로 승인 내용이 바뀔 수 있으므로
사용자가 검토한 목업을 로컬 HTML/에셋 등으로 export하고 관련 파일을 모두 bundle에 등록한다.
외부 서비스만 가능한 경우 결과를 확보할 때까지 설계 완료로 처리하지 않는다.
UI가 없는 기능은 설계 문서와 nonUiReason을 남긴다.

`complete design`에는 Markdown 대신 다음 JSON을 전달한다. 경로는 프로젝트 루트 기준이다.

```json
{
  "kind": "design",
  "surface": "web",
  "document": "docs/development/invite-team/02-design.md",
  "mockup": {
    "provider": "Claude Design",
    "invocation": "/claude-design",
    "entry": "docs/development/invite-team/mockup/index.html",
    "files": ["docs/development/invite-team/mockup/index.html"]
  }
}
```

파일명은 `docs/development/<feature>/design-bundle.json`을 사용한다. 목업의 로컬 CSS/JS/이미지도
files에 추가한다. non-ui bundle은 mockup 대신 `"nonUiReason": "구체적인 UI 미해당 이유"`를 담는다.
설계 문서·목업 파일·bundle의 해시가 한 설계 승인에 묶인다.

## 계획: 두 문서, 한 승인

writing-plans → qa-planning → plan-eng-review 순서다. QA 계획은 `QA_PLAN-<feature>.md`로 분리하고
수용 기준 연결, Given/When/Then, 권한·경계·실패·동시성·회귀·테스트 데이터를 담는다.
plan-eng-review는 QA를 실행할 서버·계정·실패 주입 환경까지 확인한다. 빠진 요구사항은 구현 계획으로
돌려 수정한 뒤 둘을 함께 승인한다. QA 계획 자체의 handoff 확인은 이 계획 승인으로 충족한다.

`complete plan`에는 다음 `plan-bundle.json`을 전달한다.

```json
{
  "kind": "plan",
  "surface": "web",
  "implementation": "docs/development/invite-team/03-plan.md",
  "qaPlan": "docs/development/invite-team/QA_PLAN-invite-team.md"
}
```

non-ui는 설계 bundle과 같은 surface 및 nonUiReason을 포함한다. API/CLI QA 시나리오도 작성한다.
UI가 있는 계획의 활성 `QA-E2E/NEG/EDGE/REG-000` ID는 모두 브라우저 QA 보고서에 포함한다.
ID는 블록 첫 줄 또는 회귀 표의 첫 열에 적는다. 폐기 ID는 같은 줄에 `[withdrawn]`과 이유를 표시한다.
브라우저만으로 확인할 수 없는 데이터/API 단언은 화면 동작 후 승인된 읽기 도구로 근거를 보강한다.
승인 후 시나리오를 빼거나 기대 결과를 약화하지 않는다. 수정이 필요하면 계획을 재승인받는다.
QA 계획·구현 계획의 해시를 모두 검사하므로 한 파일만 바뀌어도 승인/진행/커밋이 차단된다.

## 독립 코드 리뷰

Task별 및 전체 리뷰는 새 Claude 세션에서 수행한다. 구현 대화는 재사용하지 않고 승인 문서,
QA 계획, base_commit..task_commit, 테스트 근거를 전달한다. Main Claude는 보고서를 취합한다.
Task별 build 보고서 항목에는 implementation dispatch와 아래 reviewer를 함께 적는다.
전체 review 보고서는 reviewer의 필드를 최상위에 적고 기존 verdict/head/fingerprint/findings를 유지한다.

```json
{"executor":"claude","role":"code-review","dispatch":"actual-review-session-or-log","freshSession":true}
```

단순히 freshSession을 쓰는 것으로 독립성이 증명되지는 않는다. Controller가 실제 runtime 세션/로그를
대조한다. 검사기는 구현 dispatch와 동일한 리뷰/QA dispatch, 잘못된 실행 담당을 거부한다.

## Codex 독립 브라우저 QA

새 Codex 세션에 `.agents/skills/harness-browser-qa/SKILL.md` 또는 설치된 동명 스킬을 명시적으로 전달한다.
Claude의 webapp-testing을 자동으로 읽는다고 가정하지 않는다. 이 스킬은 같은 목적의
페이지 탐색 → 렌더 상태 확인 → 행동 → 관찰 가능한 단언 → 화면/로그 근거 수집을 수행한다.

데스크톱은 연결된 Browser/Computer Use를 사용할 수 있다. CLI/Orca 워커는 Playwright MCP를 기본으로
사용하고, 실제 연결된 Chrome DevTools MCP 또는 Playwright 실행 환경도 같은 계약으로 사용할 수 있다.
확인한 CLI 연결 명령은 `codex mcp add playwright -- npx -y @playwright/mcp@0.0.80 --browser chrome --isolated`이다.
이 버전은 기본적으로 창을 표시하고, isolated로 개인 Chrome 프로필을 사용하지 않는다.
이미 같은 이름의 연결이 있으면 덮어쓰지 않고 실제 설정을 먼저 확인한다. 새 Codex 세션에서 적용된다.
데스크톱 도구가 CLI에 상속된다고 가정하지 않는다. 설치만으로 doctor가 브라우저 PASS를 선언하지 않는다.
워크스페이스·로컬 서버 접근·브라우저 실행·페이지 조작·스크린샷 저장을 **QA 워커 자신의 환경**에서
먼저 확인한다. 사용자 요청대로 가능한 환경에서는 창을 표시한다. headless만 가능한 경우 이유를 보고한다.
실행 불가/인증 누락은 BLOCKED, 미실행은 NOT_RUN이다. 자동으로 Claude QA로 바꾸지 않는다.
소스 수정은 금지하지만 QA 스크립트·로그·화면 파일은 `docs/development/<feature>/qa/`에 쓸 수 있다.

QA 보고서 예시(기존 verdict/head/fingerprint/findings 필드 포함):

```json
{
  "executor": "codex",
  "role": "browser-qa",
  "dispatch": "actual-fresh-codex-qa-session-or-log",
  "freshSession": true,
  "browser": {
    "tool": "playwright-mcp",
    "session": "actual-browser-context",
    "preflight": "PASS",
    "evidence": "docs/development/invite-team/qa/preflight.md"
  },
  "scenarios": [{
    "id": "QA-E2E-001",
    "url": "http://localhost:3000/invites",
    "result": "PASS",
    "expected": "초대 완료 문구가 표시된다",
    "actual": "화면에 초대 완료 문구가 표시됨",
    "evidence": "docs/development/invite-team/qa/QA-E2E-001.md"
  }]
}
```

시나리오 근거에는 실행 단계, 기대·실제 결과, 시간, 화면·로그 경로를 남긴다.
실제 보고서에는 모든 활성 ID가 있어야 한다. FAIL/BLOCKED/NOT_RUN은 보존하되 phase 완료는 차단한다.
비 UI 작업에만 승인된 nonUiReason과 동일한 notApplicable을 사용하고 브라우저 실행을 주장하지 않는다.

## 실행 중인 구버전 작업

새 init은 workflowVersion=2를 기록한다. 이미 시작된 버전 없는 실행은 기존 승인 계약으로 계속한다.
현재 작업의 승인/이력을 자동 삭제하거나 조용히 새 규칙으로 승격하지 않는다. 새 계약을 적용하려면
진행 중인 워커를 먼저 종료/회수하고 현재 상태를 명시적으로 보관한 뒤 기획부터 새 실행을 시작한다.
기존 실행의 상태 파일을 직접 편집해 버전만 올리지 않는다.

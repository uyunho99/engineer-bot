# 검증 기록 — 2026-09-05

기준 커밋은 기존 `orca-autonomous-v2`의 `b64004c`입니다. 원래 체크아웃은 변경하지 않았습니다.
두 변형은 같은 커밋에서 독립된 Git worktree로 만들었으며 서로 merge하지 않았습니다.

## 실행한 명령

- `bun install --frozen-lockfile`: lockfile 생성 후 의존성을 동일하게 설치할 수 있는지 확인했습니다.
- `bun run check`: TypeScript 엄격 타입 검사와 테스트 11개, 단언 46개가 통과했습니다.
- `bun run smoke`: 네 차례의 승인 게이트와 재시도 차단을 포함한 단계 테스트 5개가 통과했습니다.
- `bun run build`: Bun CLI 번들을 Git 추적에서 제외된 `dist/`에 생성했습니다.
- `bun run harness doctor`: 설치된 의존성을 확인했습니다.
- Skill creator 빠른 검사: `SKILL.md` frontmatter 검사를 통과했습니다.

테스트에서는 허용되지 않은 단계 전환, 사용자 결정 요구, 산출물 변경, 소스 지문, worktree 격리,
잠금, 심볼릭 링크를 통한 경로 이탈을 확인했습니다.
어댑터 통합 테스트는 설치본과 같은 응답 형식을 내는 모의 CLI를 사용합니다. Task·Dispatch·Gate 상태 보존,
완료 처리, 지원하지 않는 업그레이드 거부를 확인했습니다. 설치된 앱 소스에서 dispatch와 터미널 결과 schema,
JSON 문자열 메시지 payload 형식도 확인했습니다. 오래된 ID, 본문에만 적힌 `PASS`, 관련 없는 메시지는
테스트에서 거부합니다.

실제 런타임 smoke 검사에서는 Task `task_adac4e528637`와 Gate `gate_d8f56511de69`를 만들고 테스트 게이트를
해결한 뒤 코디네이터 소유 메타데이터 Task를 완료했습니다. 이 검사에서는 워커를 배정하지 않았고 실제
사용자 승인을 표현하지도 않았습니다. 전역 상태를 초기화하지 않았습니다.

## 검증 범위

이 저장소에는 웹 UI가 없어 이번 하네스 변경에는 브라우저 실행이 해당하지 않습니다.
앞으로 UI 기능을 개발할 때는 제공된 workflow에 따라 실제 브라우저 QA를 수행해야 합니다.
유료 Claude·Codex 워커의 전체 흐름은 실행하지 않았습니다. Hook과 상태 검사는 협업을 위한 로컬
운영 규약을 강제하지만 OS sandbox나 인증된 사용자 식별 경계는 아닙니다. 외부 도구 권한 관리와
실제 근거 검토는 계속 필요합니다. 정확한 사용법은 `OPERATIONS.md`에서 확인합니다.


## 2026-09-06 Controller repository control

- 타입 검사와 전체 테스트: 16개 통과, 실패 0. CLI 번들 빌드 통과.
- Skill frontmatter/구조 검사와 Markdown 상대 링크 검사 통과.
- 공통 정책, repository-control 구현, lifecycle 테스트는 두 브랜치에서 동일함.
- 실제 임시 linked worktree: READY_FOR_COMMIT → gate → Controller commit → 고정 SHA 리뷰 → 수정 커밋 재검토 검증.
- 범위 밖 파일, 민감 파일, 기존 staging, 오래된 gate, 실패/불완전 보고서, 오래된 리뷰,
  literal pathspec 이름, 삭제/rename, 승인 설정 변경, commit hook 내용 변경 검증.
- Orca mock runtime에서 구현 완료 후 실제 Controller commit의 immutable range를 리뷰 dispatch에 전달하는 흐름을 검증함.
- 실제 유료 모델 worker 전체 실행은 수행하지 않음. 전역 설치와 기존 운영 브랜치는 변경하지 않음.
- 새 필수 ledger 계약 때문에 기존 build 보고서는 실제 commit/review 근거로 전환해야 함.
- 두 실행 경로는 독립 브랜치이며 별도로 적용/배포해야 함. 공통 파일 변경 시 양쪽 동기화 필요.


## 2026-09-06 — 목업·QA 계획·Codex 독립 QA

- 새 실행 workflowVersion=2: 설계 문서+목업, 구현 계획+별도 QA 계획의 파일 해시를 승인에 연결.
- 첨부 `Qa planning-v1.zip`의 skill/template/edge catalog/evals를 보존하고 하네스 승인 연계를 추가.
- Claude Task/전체 코드 리뷰, 새 Codex 브라우저 QA의 담당·별도 dispatch·freshSession 검사.
- 누락/중복 QA ID, FAIL/BLOCKED/NOT_RUN, 실제 근거 파일 누락, 웹 계획의 임의 QA 생략을 거부.
- 네이티브 19개 / Orca 21개 테스트 통과. 두 경로 타입 검사·빌드 및 3종 스킬 구조 검사 통과.
- Playwright MCP 0.0.80 + 실제 Chrome(창 표시, isolated)으로 로컬 fixture 접속·버튼 클릭·
  `Scenario passed` 표시를 확인하고 스크린샷을 열어 검수. 이 검증은 브라우저 연결 smoke이며
  Codex 모델을 호출한 전체 제품 개발/QA 또는 Claude Design 목업 생성 테스트는 아니다.
- 현재 Orca live doctor는 `Orca runtime not ready`. Task/dispatch/독립 QA 배정은 모의 런타임으로 검증.
- 구버전의 진행 중인 실행은 기존 승인 계약을 유지한다. 상태/이력을 자동으로 초기화하지 않는다.
- 사용자 전역 native 하네스, qa-planning, harness-browser-qa 설치 완료. 기존 모델/설정 보존 검사 통과.
- Codex 사용자 MCP `playwright`를 0.0.80 / chrome / isolated로 등록하고 활성 설정을 확인.

## 2026-09-06 — 독립 코드 리뷰 담당 변경

- 사용자 요청으로 Task별/전체 독립 코드 리뷰도 새 Codex 세션으로 변경.
- 구현 dispatch 재사용, 잘못된 role, freshSession 누락, Claude 리뷰 보고서를 거부.
- 네이티브는 codex:codex-rescue --wait --fresh, Orca는 별도 codex 리뷰 Task로 배정.
- 기존 목업·QA 계획·Controller 커밋·독립 브라우저 QA 계약 유지.
- 변경 후 네이티브 19개 / Orca 21개 테스트, 타입 검사·빌드 통과. 실제 모델을 호출한 전체 리뷰 실행은 포함하지 않음.

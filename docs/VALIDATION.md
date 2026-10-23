# 검증 기록 — 전역 설치판

최종 문서 정리: 2026-09-06. 현재 코드와 전역 설치 동작에 대한 검증입니다.

## 현재 검증 결과

- `bun run check`: TypeScript 엄격 타입 검사와 테스트 9개·단언 78개 통과.
- `bun run build`: Bun CLI 번들 생성 성공.
- `bun run install:global`: 사용자 스킬·전역 실행 명령·hook 설치 성공.
- `~/.local/bin/development-harness doctor`: Superpowers 6.2.0, gstack 1.6.1.0, 사용자 범위 Codex 플러그인과 실행 도구 확인.
- Skill creator 빠른 검사: 설치된 SKILL.md 형식 검사 통과.

## 확인한 동작

임시 사용자 디렉터리와 독립 Git 프로젝트에서 설치 반복 시 중복 방지, 기존 설정 보존,
공백·따옴표 경로, 미적용 프로젝트 hook 통과, 적용 프로젝트 편집 제한, 프로젝트별 상태 분리,
대상 프로젝트 검증 명령의 성공·실패를 확인했습니다.

단계 테스트는 제품·설계·계획·UAT 승인, 잘못된 단계 전환 거부, 실패 후 재시도,
승인 자료와 검증 설정 변경 감지, 소스 지문, worktree 격리, 잠금, 심볼릭 링크 경로 이탈을 확인합니다.
CLI 통합 테스트는 fixture로 기획부터 승인·worktree·개발·리뷰·QA·검증·UAT·완료까지 실행합니다.
따옴표로 감싼 전역 명령 및 번들 CLI의 에이전트 직접 승인도 hook에서 차단합니다.

## 문서 적용 범위

README, 운영 쿡북, CLAUDE.md, 스킬 원본과 설치된 문서를 전역 설치 흐름에 맞춥니다.
일반 사용 명령은 `~/.local/bin/development-harness`이며, `bun run check/build`는
하네스 자체 개발용입니다. 이전 프로젝트 전용 설치판의 8개·53개 검사 수치는 현재 결과가 아닙니다.

## 검증하지 않은 부분

실제 Claude·Codex 모델이 기능 하나를 처음부터 끝까지 개발하는 전체 실행은 수행하지 않았습니다.
로그인·모델 호출 성공은 doctor의 검증 범위가 아닙니다. 이 하네스에는 웹 UI가 없으므로
하네스 변경 자체에 브라우저 QA는 해당하지 않으며, 대상 UI 개발에서는 실제 브라우저 QA가 필요합니다.
Hook은 로컬 운영 절차를 보조하며 OS sandbox나 인증된 사용자 식별 경계가 아닙니다.

## 공식 근거

- [개인 스킬과 적용 범위](https://code.claude.com/docs/en/skills)
- [사용자 설정](https://code.claude.com/docs/en/settings)
- [Hook 입출력과 차단 규칙](https://code.claude.com/docs/en/hooks)

## 구현 담당 교정

Claude는 기획·관리·리뷰만 맡고 모든 코드·테스트·수정은 Codex에 위임하도록 교정했습니다.
개발 단계에서도 Claude의 직접 코드 편집이 거부되는지, Claude 실행자로 작성된 구현 보고서가
거부되는지 회귀 검사했습니다. 이전 구현 보고서는 각 Task에 executor=codex 및 실제 dispatch
근거가 필요하며, Claude가 수행한 결과를 Codex 결과로 바꿔 적어서는 안 됩니다.
실제 Codex 모델로 새 기능 전체 실행은 아직 검증하지 않았습니다.


## 2026-09-06 Controller repository control

- 타입 검사와 전체 테스트: 14개 통과, 실패 0. CLI 번들 빌드 통과.
- Skill frontmatter/구조 검사와 Markdown 상대 링크 검사 통과.
- 공통 정책, repository-control 구현, lifecycle 테스트는 두 브랜치에서 동일함.
- 실제 임시 linked worktree: READY_FOR_COMMIT → gate → Controller commit → 고정 SHA 리뷰 → 수정 커밋 재검토 검증.
- 범위 밖 파일, 민감 파일, 기존 staging, 오래된 gate, 실패/불완전 보고서, 오래된 리뷰,
  literal pathspec 이름, 삭제/rename, 승인 설정 변경, commit hook 내용 변경 검증.
- 임시 홈에서 전역 설치와 정책 동반 배포를 검증함.
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

## 2026-10-23 — 하네스 3.0.0: 트랙·설정 가능한 엔진·호스트 중립 컨트롤러

설계는 `docs/development/harness-v2/design-doc.md`, 1단계 계획은 같은 폴더의 `plan-phase1.md`.

- `bun run check`: 테스트 65개 통과(타입 검사 포함). `bun run build` 통과.
- light 트랙을 CLI로 기획 → 계획 → 계획 승인까지 진행하고 `--escalate`로 full 설계 단계로 승격하는 흐름을 검사.
- 상태는 메인, 코드는 worktree: 기존 전체 흐름 테스트를 메인 체크아웃에서 worktree를 대상으로 끝까지 실행.
  controller commit이 worktree 브랜치에 쌓이고 메인 HEAD가 움직이지 않는 것을 검사. 상태가 worktree 안에 있는 구버전 실행도 커밋되는 것을 검사.
- 수정 라운드: 태스크별 집계, `maxFixRounds`·`maxTotalFixRounds` 반영.
- 엔진: 사람 층/프로젝트 층 병합, 계획 완료 시 고정, gemini 구현자 보고서 수락·codex 거부, `requireCrossEngineReview`,
  호스트별 기본값(codex 컨트롤러는 `codex exec`), Claude Code가 아닌 호스트에서 `claude-agent` 거부.
- `dispatch`: 단계·범위·준비 상태 거부, 셸 템플릿 치환, 계획 절 발췌, 리뷰어의 고정 커밋 범위.
- 전달 승인: `actor`와 인용 기록, `approval.allowRelay: false` 거부, heredoc 본문은 차단하지 않고 실제 명령은 계속 차단.
- 가드: 원장에 없는 제품 커밋 거부, 감시자의 범위 밖 변경 기록(실제 백그라운드 프로세스 포함), CLI 경고와 `complete`·`decide` 거부, `guard --ack`,
  pre-commit의 범위 밖 커밋 거부와 `core.hooksPath`·기존 훅 앞에서의 설치 생략.
- 설치: `--host codex`가 `~/.claude/`를 건드리지 않음, 호스트 둘을 설치해도 CLI는 하나, 구버전 배치의 hook 이전, 다운그레이드 거부.
- 백그라운드 의존성 준비는 `npm install`로 실제 실행해 `running → ok`를 확인.

검증하지 않은 것:

- 실제 모델(Claude·Codex·Gemini)로 기능 하나를 처음부터 끝까지 개발하는 실행.
- Gemini CLI 기본 워커 플래그(`gemini -y -p`): 이 머신에 Gemini CLI가 없다. codex 플래그는 codex-cli 0.153.4로 확인했다.
- Antigravity 컨트롤러: 스킬 위치와 비대화 실행 방법이 확인되지 않아 지원하지 않는다.
- 부하가 큰 머신(load average 16~24)에서 서브프로세스가 많은 테스트 셋이 bun 기본 5초를 넘어,
  해당 파일의 기본 타임아웃을 30초로 올렸다. 직전 커밋에서도 같은 실패를 재현해 회귀가 아님을 확인했다.

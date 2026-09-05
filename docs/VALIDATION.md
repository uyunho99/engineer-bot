# 검증 기록 — 전역 설치판

최종 문서 정리: 2026-09-06. 현재 코드와 전역 설치 동작에 대한 검증입니다.

## 현재 검증 결과

- `bun run check`: TypeScript 엄격 타입 검사와 테스트 9개·단언 76개 통과.
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

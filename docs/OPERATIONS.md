# 운영 쿡북

## 자동 라우팅

Lead는 모든 저장소 변경 요청을 `small-change`, `bug`, `feature`, `high-risk`로 분류합니다. feature와 high-risk는 gstack으로 수용 기준·영향 경로·위험을 계획하고, Superpowers의 계획·TDD·검증 규율을 적용합니다. 모든 경우 Orca DAG를 만들고 구현 뒤 독립 Claude 리뷰와 QA를 거칩니다.

## 전환 규칙

```text
계획 → 구현 → 리뷰 → (PASS → QA | FIX_REQUIRED → 수정 → 재리뷰)
QA → 최종 검증 → (필요 시 사람 릴리스 게이트)
```

- `PASS`: 다음 의존 태스크를 열기
- `FIX_REQUIRED`: Codex fixer 태스크와 새 Claude 재리뷰 태스크 생성
- `BLOCKED`: 워커 질문이면 `ask/reply`, coordinator 결정이면 사람 게이트
- `ESCALATE`: 영향을 받은 branch를 멈추고 선택지·권장안·근거가 있는 게이트 생성
- 같은 태스크의 연속 배정 실패 3회: circuit-breaker. 새 시도 전 사람 게이트 필수

## 사람 게이트

프로덕션, 마이그레이션, 보안·인증, 유료·외부 실행, 되돌리기 어려운 작업, 사용자가 요청한 승인에 필요합니다. 게이트에는 결정, 선택지, 권장안, 영향, 근거, 잠금 해제할 태스크를 적습니다.

## Smoke test

1. `bun run smoke`로 dry-run DAG와 lifecycle 계약을 검사합니다.
2. Orca Claude Lead, Codex worker, 독립 Claude reviewer/QA 터미널을 준비합니다.
3. 안전한 순수 함수·단위 테스트 변경을 `--execute`로 실행합니다.
4. `task-list`, `dispatch-show`, `gate-list`에 계획→구현→리뷰→QA 기록이 모두 있는지 확인합니다.
5. 의도적인 `FIX_REQUIRED`를 한 번 만들어 fixer와 재리뷰가 분리되는지 확인합니다.

변경이 성공해도 Orca 태스크·디스패치 provenance가 없으면 orchestration smoke test는 실패입니다.

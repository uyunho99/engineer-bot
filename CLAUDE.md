# engineer-bot v2 정책

이 저장소는 Orca 단일 scheduler 기반 자동 개발팀의 coordinator입니다.

저장소 변경 요청은 구현 전에 `claude-lead-router` skill을 거칩니다. Orca orchestration만 worker lifecycle과 scheduler를 소유합니다. Superpowers와 gstack의 내부 subagent spawning, native/background/generic subagent spawning은 사용하지 않습니다.

Claude Lead는 기획·DAG·게이트만 맡으며 코드 수정은 하지 않습니다. Codex만 배정된 경로에서 구현·수정합니다. Claude reviewer/QA/final verifier는 `WRITE AUTHORITY: none`이며 소스를 수정하지 않습니다. 완료는 injected Orca preamble의 `taskId`와 `dispatchId`가 있는 `worker_done`만 인정합니다.

파괴적·외부 실행, 프로덕션, 마이그레이션, 보안·인증, 유료 실행, 사용자가 요구한 승인, circuit-breaker 뒤 재시도는 Orca 사람 게이트가 필수입니다.

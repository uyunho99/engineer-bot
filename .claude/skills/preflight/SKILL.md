---
name: preflight
description: 계획서(plan.md)의 할 일 간 모순을 게이트 ① 앞에서 찾는다. 기계 1단계 + AI 2단계. 결함을 찾으면 하나씩 채택/기각을 물어보고 채택분만 반영한다.
---

# 계획서 사전 검사

설계: [docs/plans/<slug>/design-doc.md](../../../docs/plans) · 결정 D1~D29

## 순서 — 이 순서를 바꾸지 마라

**1. 1단계 기계 검사**

```bash
bin/preflight "$(git branch --show-current)" --plan
```

출력 JSON 을 그대로 다음 단계의 `args` 로 쓴다. 값을 손으로 옮기지 마라.

**2. 2단계 AI 검사**

`Workflow({ scriptPath: "workflows/plan-preflight.js", args: <1단계 출력> })`

시작 전에 규모를 한 줄로 알린다 — 짝 개수, 예상 에이전트 수, 동시성 캡으로 나눈 웨이브 수.
묻는 것이 아니라 알리는 것이다.

워크플로우 반환값을 `docs/plans/<slug>/preflight-raw.json` 에 **그대로** 쓴다.
요약하거나 다시 쓰지 마라 — 파일 + JSON 이 유일한 경계다 (하드룰 #4).

**3. 결과 기록**

```bash
bin/preflight "$(git branch --show-current)" --record
```

`CLEAN` 이면 여기서 끝이다. 게이트 ① 로 넘어간다.

**4. 사람 결정 — 결함마다 하나씩**

`REJECTED` 면 결함마다 `AskUserQuestion` 을 **하나씩** 던진다.

- **일괄 승인을 제공하지 마라.** "전부 적용" 선택지를 만들지 마라 (설계 D13).
  결함이 많아 번거롭다면 그것은 계획서를 다시 만들라는 신호다.
- `stage: 1` 결함은 기계가 확정한 것이다. `stage: 2` 는 AI 판단이므로 오탐일 수 있다.
  사람에게 이 차이를 알려라.
- 결함의 `patch.text` 를 **그대로** 보여줘라. 다시 쓰지 마라 — 승인한 텍스트가
  그대로 들어간다 (설계 D14).

**5. 채택분 적용**

```bash
bin/preflight "$(git branch --show-current)" --apply <채택한 결함 id들>
```

종료 코드 3 은 앵커 후보가 여럿이라는 뜻이다. 후보 위치를 사람에게 보여주고 고르게 한다
(설계 D22). 첫 번째를 조용히 고르지 마라.

**6. 재검사**

적용하면 `plan.md` 해시가 바뀌므로 1단계로 돌아간다. `CLEAN` 이 나올 때까지 반복한다.

## 하지 않는 것

- `plan.md` 를 직접 편집하지 마라. `--apply` 만이 계획서를 바꾼다
- 결함을 요약해서 한꺼번에 묻지 마라 (D13)
- `preflight-raw.json` 의 값을 손으로 옮기지 마라 (하드룰 #4)

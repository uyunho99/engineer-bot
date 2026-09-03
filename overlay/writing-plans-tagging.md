# writing-plans 오버레이 — 2축 태깅

> **주입 방식** — `superpowers:writing-plans` 실행 시 이 파일을 함께 읽힌다.
> 원본 스킬은 수정하지 않는다 (명세 P4).
>
> **근거** — 명세 §3.4, [AMENDMENTS.md](../AMENDMENTS.md) B4.

---

## 왜 태그가 필요한가

팀에 개발자가 없다 (명세 비목표). 사람의 코드 리뷰가 없으므로 검증은 **테스트(기계) + 데모(사람)** 뿐이다.
그런데 모든 코드가 같은 방식으로 검증되지 않는다:

- 입출력이 확정적인 코드는 테스트로 증명된다 → **TDD**
- 비결정적 생성 로직은 테스트로 증명이 안 된다 → **골든셋/스냅샷**
- 화면에 드러나는 변경은 사람이 눈으로 확인한다 → **데모**
- 백엔드 로직은 눈에 안 보인다 → **테스트 커버리지가 유일한 증거**

태그는 builder-bot이 태스크마다 **어떤 증거를 만들어야 하는지** 결정하는 입력이다.
태그가 없으면 builder-bot은 무엇으로 그 태스크가 됐다고 주장할지 모른다.

## 형식 — 헤딩 다음 줄의 메타 라인

**태스크 헤딩 형식을 절대 바꾸지 마라.** superpowers `scripts/task-brief`가 태스크를 추출하는 awk는
`^#+[ \t]+Task[ \t]+[0-9]+` 로만 매칭한다. 헤딩에 태그를 끼워넣으면 추출이 깨지고
SDD 루프가 시작조차 못 한다 (AMENDMENTS B4).

태그는 **헤딩 바로 다음 줄**에 메타 라인으로 싣는다:

````markdown
### Task 3: 키워드 발산 엔진

**Tags:** verification=generative validation=invisible

**Files:**
- Create: `src/keywords/expand.ts`
- Test: `tests/keywords/expand.test.ts`

**Interfaces:**
- Consumes: `PersonaSeed` from Task 2
- Produces: `expandKeywords(seed: PersonaSeed): string[]`

**테스트로 증명할 것:**  ← invisible 태스크는 이 섹션이 필수다
- [ ] 빈 seed면 빈 배열, 예외 없음
- [ ] 반환 개수가 5~50 범위
- [ ] 금지어 목록의 단어가 결과에 없음
- [ ] 동일 seed 2회 호출 시 스키마가 동일 (값은 달라도 됨)

- [ ] **Step 1: Write the failing test**
...
````

`**Tags:**` 라인은 정확히 이 형식이다 — 컨트롤러의 계약 체커가 파싱한다:

```
**Tags:** verification=<deterministic|generative> validation=<visible|invisible>
```

## `**Interfaces:**` 는 필수다

`**Files:**` 와 `**Interfaces:**` 는 **모든 태스크에 필수다.** 계약 체커가 검증하며,
없으면 빌드가 시작되지 않는다.

`**Interfaces:**` 가 필수인 이유는 사전 검사(`/preflight`)의 1단계가 이것만 입력으로 쓰기
때문이다. 이것이 태스크 간 의존을 선언하는 유일한 자리이고, 기계가 다음 셋을 결정론적으로
잡는다:

- **매달린 참조** — `X from Task N` 인데 Task N 이 X 를 생산하지 않는다
- **순서 위반** — 앞 태스크가 뒤 태스크의 산출을 소비한다
- **서명 불일치** — 같은 심볼의 생산·소비 서명이 다르다

형식:

- `- Consumes: \`심볼\` from Task N` — 출처 태스크를 반드시 적는다. `from` 절이 없으면
  기계가 연결을 검증할 수 없다
- `- Produces: \`서명 전문\`` — 소비 쪽과 **글자 그대로 같게** 적는다. 다르면 후보로 올라가
  AI 판정 단계를 한 번 더 태운다
- 첫 태스크처럼 소비할 것이 없으면 `Produces` 만 있어도 된다

## 축 1 — verification (검증 방법)

| 태그 | 대상 | builder-bot이 할 일 |
|---|---|---|
| `deterministic` | API · 크롤 · UI 로직 · 데이터 처리 — 입출력이 확정적인 코드 | **TDD 강제.** red-green-refactor, RED/GREEN 증거를 report에 남긴다 |
| `generative` | 키워드 발산 · 페르소나 등 비결정적 생성 로직 | 골든셋/스냅샷 검증 (구조·범위·금지어 assert) |

**모호하면 `deterministic`으로 태깅한다.** 엄격한 쪽이 기본값이다.
"이건 LLM이 하는 일이라 비결정적"이라는 이유만으로 `generative`를 붙이지 마라 —
출력의 **스키마와 범위**가 확정적이면 그 부분은 `deterministic`이다.

`generative` 태스크에는 플랜에 **골든셋 경로를 명기하라.** 없으면 없다고 명기하라 —
builder-bot이 폴백(구조 assert만 + `DONE_WITH_CONCERNS`)을 쓸지 판단해야 한다.
골든셋을 새로 만드는 태스크를 플랜에 넣지 마라 — 별도 품질 트랙 소관이다 (명세 D4).

## 축 2 — validation (가시성)

| 태그 | 대상 | 게이트 ②에서의 확인 수단 |
|---|---|---|
| `visible` | UI · 화면에 드러나는 변경 | 프리뷰 데모 + 스크린샷 |
| `invisible` | 백엔드 로직 · 스키마 · 배치 | **테스트 커버리지가 전부** |

### `invisible` 태스크의 필수 요건

`invisible` 태스크에 **`**테스트로 증명할 것:**` 섹션이 없으면 self-review에서 반려하라.**
플랜을 완성으로 선언하지 마라.

- 각 항목은 **하나의 관찰 가능한 행동**이다. "제대로 동작한다" 같은 항목은 반려 사유다
- 각 항목은 실패할 수 있어야 한다 — 어떤 프로덕션 변경이 이 케이스를 깨뜨리는지 말할 수 없으면 그 케이스는 아무것도 증명하지 않는다
- 문자열 존재 검사(grep류)를 케이스로 쓰지 마라 — 관찰 대상은 **행동**이지 텍스트가 아니다

`visible` 태스크에도 테스트는 필요하다. 다만 **증거의 무게중심**이 스크린샷에 있다.

## Self-Review 체크리스트 추가 항목

원본 스킬의 self-review에 다음을 더한다. 하나라도 실패하면 플랜은 미완성이다.

- [ ] 모든 태스크 헤딩이 `### Task N: ...` 형식이다 (task-brief 추출 가능)
- [ ] 모든 태스크에 `**Tags:**` 라인이 있고, 두 축 모두 유효한 값이다
- [ ] `invisible` 태스크 전부에 `**테스트로 증명할 것:**` 섹션이 있다
- [ ] `generative` 태스크에 골든셋 경로가 명기됐거나 부재가 명기됐다
- [ ] 태그가 실제 태스크 성격과 맞다 — 모호한 것을 `generative`로 도피시키지 않았다
- [ ] `## Global Constraints` 섹션이 있고 exact value가 verbatim으로 들어갔다
- [ ] 플랜에 골든셋 **구축** 태스크가 없다 (범위 외 — 명세 D4)
- [ ] 모든 태스크에 `**Files:**` 가 있고 `Create` 또는 `Modify` 항목이 하나 이상이다
- [ ] 모든 태스크에 `**Interfaces:**` 가 있고, `Consumes` 의 심볼이 출처 태스크의 `Produces` 에 글자 그대로 존재한다
- [ ] `Consumes` 는 **한 줄에 하나**다. 세미콜론·쉼표로 여러 개를 붙이지 않았다 (파서가 뒤쪽을 버린다)
- [ ] 태스크가 아닌 출처(기존 코드·파일)는 `from Task N` 을 쓰지 않았다 — 심볼 의존만 `from` 을 쓴다
- [ ] `Produces`·`Consumes` 의 백틱 **뒤에 산문을 붙이지 않았다.** 파서는 바깥쪽 백틱만 벗기므로 설명이 심볼에 이어붙어 짝이 어긋난다 (`from Task N` 은 예외 — 파서가 처리한다)
- [ ] **파일·산출물을 `Produces` 에 적지 않았다.** `**Interfaces:**` 는 심볼만 표현한다 — `symbolName("bin/foo")` 는 `"bin"` 이 되어 거짓 매달린 참조를 만든다
- [ ] **`verification=deterministic` 태스크의 Step 4 가 테스트 러너만 부르지 않는다.** `bun test` 는 트랜스파일만 하므로 **GREEN 이 타입 무결성을 증명하지 않는다** — 타입을 정의·수정하거나 새 파일을 만드는 태스크는 `bun run typecheck` 를 함께 돌린다. 이것이 없으면 타입 오류가 세 태스크 뒤에서 터진다 (2026-09-03 1·3·4·5회전이 전부 이 계열이었다)
- [ ] **문서 전체를 검사하는 함수에 문서 조각을 먹이는 테스트가 없다.** `checkPlan` 처럼 플랜 전체 불변식(Global Constraints · Task 1..N 연속)을 보는 함수에 태스크 조각을 넣고 `toEqual([])` 를 기대하면 원리적으로 실패한다. 조각을 완전한 플랜으로 **감싸거나**, 기대를 "관심 있는 위반의 유무"로 쓴다 (2026-09-03 봇이 3회전에서 반송한 결함)

## 태그 분포 게시

플랜 완성 후 planner-bot이 스레드에 게시할 요약에 분포를 넣는다:

```
📋 태스크 N개 · deterministic A / generative B · visible C / invisible D
🧪 invisible 태스크 테스트 케이스 M건 명기됨
```

`generative`가 절반을 넘으면 스레드에 한 줄 경고를 남겨라 —
검증 가능성이 낮은 플랜이고, 골든셋 부재 시 검증 공백이 그만큼 커진다.

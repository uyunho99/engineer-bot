# 명세 수정 사항 (Amendments)

> `planner-builder-bot-spec.md`는 2026-07-23에 **superpowers 5.1.x** 기준으로 작성됐다.
> 2026-07-30 환경 복구 결과 실제 설치 버전은 **6.2.0** — 메이저 점프다.
> 아래는 명세와 업스트림 실제 동작이 충돌하는 지점, 그리고 gstack 스킬을 실측해서
> 드러난 명세의 사실 오류다. **각 항목의 "적용" 열이 구현의 근거다.**
>
> 원 명세는 수정하지 않는다 (결정 이력 보존). 충돌 시 **이 문서가 우선한다.**

---

## A. superpowers 6.2.0 vs 명세

### A1. P5 폐기 — 리뷰어 서브에이전트는 업스트림의 기본 구조가 됐다

**명세 P5**: "리뷰는 최신 구조(인라인 self-review). **별도 리뷰어 서브에이전트 2단 루프는 사용하지 않음.**
근거: 업스트림 회귀 테스트에서 실행시간 ~2배, 품질 개선 미측정"

**실제 6.2.0** (`skills/subagent-driven-development/SKILL.md`):
- 태스크마다 **task reviewer 서브에이전트**를 띄운다 (`task-reviewer-prompt.md`)
- 수정 라운드마다 **scoped re-reviewer**를 띄운다 (`re-review-prompt.md`)
- 마지막에 **whole-branch code reviewer**를 띄운다 (`../requesting-code-review/code-reviewer.md`)
- SKILL.md 원문: *"Implementer self-review never replaces the task review; both are needed."*

**판정** — P5는 5.1.x 시점의 관찰이었고, 6.x는 그 반대 방향으로 갔다.
P5를 지키려면 스킬 본문을 억제해야 하는데 그건 **P4(fork 금지, 원본 유지)와 정면 충돌**한다.

| | 결정 |
|---|---|
| **채택** | 업스트림의 리뷰어 구조를 **그대로 받아들인다.** P5를 폐기한다 |
| 근거 | 오버레이로 스킬의 핵심 루프를 억제하는 것은 사실상 fork다. 유지보수 비용이 P5의 이득(실행시간)보다 크다 |
| 대가 | 태스크당 실행시간·토큰 증가. 모델 라우팅(§5.4 / A4)으로 상쇄한다 |
| 적용 | `overlay/CLAUDE.builder.md` — 리뷰어 억제 지시를 넣지 않는다 |

### A2. §6.2 재시도 한도 3회 → 업스트림은 5회 + 판결(adjudication)

**명세 §6.2**: 태스크당 self-review 재시도 3회, 초과 시 BLOCKED.

**실제 6.2.0**: 5라운드 서킷 브레이커. R≤3은 같은 implementer를 resume,
**R≥4는 fresh implementer + 한 단계 상위 모델**. R=5에서 브레이커가 트립하면
컨트롤러가 각 미해결 finding을 **판결**한다 — load-bearing이 하나라도 있으면 BLOCKED,
없으면 ledger에 rulings와 함께 park하고 완료 처리.

| | 결정 |
|---|---|
| **채택** | 업스트림 5라운드를 쓴다. 3회로 깎지 않는다 |
| 근거 | 명세의 3회는 "무한 루프 방지"가 목적이다. 5라운드 + 판결은 그 목적을 이미 충족하고, R≥4 모델 에스컬레이션이라는 회복 경로를 추가로 준다. 3회로 자르면 그 경로를 버린다 |
| 추가 | 명세의 의도는 **컨트롤러 바깥의 벽**으로 옮긴다 — `builder.ts`의 세션 타임아웃(§B2)이 무한 루프의 최종 방어선이다 |
| 적용 | `overlay/CLAUDE.builder.md` · `controller/builder.ts` (타임아웃) |

### A3. **사람 질문 지점 2곳** — headless 봇에서는 §6.3 반송으로 변환해야 한다

6.2.0 SDD는 headless와 충돌하는 사람 개입 지점을 **2개** 갖는다. 명세 §5.1은
builder-bot이 정형 보고와 BLOCKED 외에는 발화하지 않는다고 규정하므로, 둘 다 변환이 필요하다.

| # | 업스트림 동작 | 위치 | 변환 |
|---|---|---|---|
| 1 | Task 1 디스패치 전 **플랜 사전 스캔** — 태스크 간 모순, 리뷰 루브릭이 결함으로 볼 항목을 찾아 "which governs?"를 **한 번에 묶어 사람에게 질문** | SKILL.md `## Setup` 끝 | 질문하지 않고 **`REJECTED`** — 플랜 결함이므로 §6.3 반송. **빌드 시작 전이라 손실이 0이다. 이 경로가 가장 값싸다** |
| 2 | 수정 루프에서 finding이 **플랜 텍스트와 충돌**하면 "present the finding and the plan text, ask which governs" | SKILL.md `### 4. The fix loop` | 질문하지 않고 **`REJECTED`** — §6.3 "빌드 중 플랜 결함 발견 시 반송, 현장 수정 금지"와 정확히 일치 |

**이 변환이 명세 §6.3을 강화한다.** 원 명세는 §6.3을 "판정되면"이라는 모호한 조건으로 뒀지만,
업스트림이 그 판정 지점을 **두 곳에 명시적으로** 만들어 놨다. 오버레이는 그 두 곳을 이름으로 지목한다.

### A4. §5.4 모델 정책 — 업스트림 정책이 더 세밀하다. 명세를 대체한다

업스트림 `## Model Selection`이 명세 §5.4의 3행 표보다 구체적이다. 특히:

- **"Always specify the model explicitly when dispatching a subagent."** 생략하면 세션 모델(보통 최상위)을 상속 → 비용 정책이 조용히 무력화된다
- **"Turn count beats token price."** 최저가 모델이 멀티스텝에서 턴을 2~3배 써서 총비용이 더 나온다 → **리뷰어와 산문 기반 implementer의 하한은 중간 티어**
- 플랜 텍스트에 코드가 그대로 있으면 = 전사(transcription) 작업 → 최저가 티어
- **최종 whole-branch 리뷰는 최상위 모델** (세션 기본값이 아니라 명시적으로)
- 수정 라운드 4~5는 막힌 implementer보다 **한 티어 위**

| | 결정 |
|---|---|
| **채택** | 업스트림 정책을 그대로 쓴다. 명세 §5.4는 그 요약으로 격하 |
| 적용 | `overlay/CLAUDE.builder.md` — "모델 명시 누락 금지"를 하드 룰로 |

### A5. 워크스페이스가 삭제된다 — Discoveries를 그 안에 쌓으면 사라진다

6.2.0은 워크스페이스를 **플랜 단위**로 만들고(`.superpowers/sdd/<plan-basename>/`),
**최종 리뷰가 깨끗해지면 삭제한다** ("Final review clean: delete this plan's workspace").
`git clean -fdx`도 지운다 (git-ignored scratch).

명세 §5.5는 builder-bot이 세션 중 `discoveries.md`를 누적한다고 규정한다.
**그 파일을 SDD 워크스페이스 안에 두면 성공 시 소멸한다.**

| | 결정 |
|---|---|
| **채택** | `discoveries.md`는 **`docs/plans/<branch>/discoveries.md`** — git 트래킹되는 계약 경로(§4.1)에 둔다. SDD 워크스페이스가 아니다 |
| 근거 | P7(파일이 단일 진실) + 워크스페이스는 소멸 대상 |
| 적용 | `controller/paths.ts` · `overlay/CLAUDE.builder.md` |

### A6. §5.3의 4개 신호는 **SDD 세션 내부** 신호다 — 컨트롤러용 계약이 따로 필요하다

명세 §5.3 표(`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`)는
업스트림 implementer 보고 상태와 **문자 그대로 일치**한다 — 명세가 여기서 유도된 것이다.

그런데 이 신호는 **implementer 서브에이전트 → SDD 컨트롤러(=세션 자신)** 방향이다.
builder-bot의 외부 컨트롤러(`builder.ts`)는 세션 **바깥**에 있으므로 이 신호를 볼 수 없다.

| | 결정 |
|---|---|
| **채택** | 2층 계약. **내부** = 업스트림 4신호 (건드리지 않음). **외부** = 세션이 종료 시 `docs/plans/<branch>/build-result.json`에 쓰는 구조화 결과 |
| 근거 | `claude -p` stdout을 grep하면 반드시 깨진다. 파일 + JSON 스키마가 유일하게 견고한 경계 |
| 파싱 실패 | 조용히 성공 처리하지 않는다 → `BLOCKED` |
| 적용 | `controller/contract.ts` (스키마) · `overlay/CLAUDE.builder.md` (쓰기 의무) |

---

## B. gstack 실측 — 명세 §4.1의 사실 오류

### B1. `GSTACK_HOME`만으로는 경로를 못 돌린다 — 심링크가 필요하다

명세 §4.1은 "gstack 기본 경로(`~/.gstack/projects/`)는 레포 내 경로로 심링크 **또는 설정 변경**"이라고
두 선택지를 열어 뒀다. 실측 결과 **설정 변경 단독으로는 불가능하다.**

| 스킬 / 위치 | 경로 해석 | `GSTACK_HOME` 존중? |
|---|---|---|
| `office-hours` 컨텍스트 복구 · learnings | `${GSTACK_HOME:-$HOME/.gstack}/projects/$SLUG` | ✅ |
| `plan-ceo-review` learnings · 컨텍스트 복구 | `${GSTACK_HOME:-$HOME/.gstack}/projects/$SLUG` | ✅ |
| **`plan-eng-review` 설계문서 탐색** (SKILL.md:881,882) | `~/.gstack/projects/$SLUG/*-$BRANCH-design-*.md` | ❌ **하드코딩** |
| **`plan-eng-review` 테스트플랜 산출** (SKILL.md:1214,1219) | `~/.gstack/projects/$SLUG/` | ❌ **하드코딩** |

**결정** — `GSTACK_HOME`은 쓰지 않는다. **심링크 하나로 전부 잡는다:**

```
~/.gstack/projects/engineer-bot  →  <repo>/docs/gstack/
```

심링크는 `GSTACK_HOME` 존중 여부와 무관하게 작동하므로 4행 전부 커버한다.
`bin/setup-paths.sh`가 수행하고 멱등이다.

### B2. gstack 산출 파일명은 `design-doc.md`가 아니다 — 계약 경계에 정규화 단계가 필요하다

명세 §4.1은 `docs/plans/<branch-slug>/design-doc.md`를 고정 경로로 규정한다.
실제 gstack 산출물:

```
~/.gstack/projects/{slug}/{user}-{branch}-design-{datetime}.md
~/.gstack/projects/{slug}/{user}-{branch}-eng-review-test-plan-{datetime}.md
```

- 브랜치가 파일명에 들어가고 (`/`→`-`), 타임스탬프가 붙는다
- `plan-eng-review`는 설계문서를 **glob + `ls -t`** 로 찾는다 (`*-$BRANCH-design-*.md`)

즉 파일명을 `design-doc.md`로 바꾸면 **eng-review가 자기 입력을 못 찾는다.**

**결정** — gstack의 명명 규칙은 **건드리지 않는다**(P4). 대신 **계약 경계에 정규화(materialize) 단계**를 둔다:

```
docs/gstack/{user}-{branch}-design-{ts}.md     ← gstack이 자유롭게 씀 (glob 탐색 유지)
        │  materialize (ls -t 로 최신 선택)
        ▼
docs/plans/<branch-slug>/design-doc.md         ← 계약 경로. builder의 유일한 입력
```

`controller/materialize.ts`가 수행한다. **핸드오프 계약(§4)의 물리적 경계가 여기다** —
계약 위쪽은 gstack의 세계(자유 명명), 아래쪽은 우리 계약(고정 경로).

### B3. 라우팅 소유권(P6)은 **선점**으로 얻는다 — 삭제가 아니다

명세 §3.3은 "gstack이 CLAUDE.md에 자동 삽입하는 라우팅 블록은 **설치 후 삭제**하고 대체"라고 규정한다.
실측 결과 삭제는 **불안정한 방법**이다 — 스킬이 다시 물어보고 다시 삽입한다.

`plan-ceo-review/SKILL.md:97`:
```bash
if [ -f CLAUDE.md ] && grep -q "## Skill routing" CLAUDE.md 2>/dev/null; then
  _HAS_ROUTING="yes"
fi
```

판정은 **`## Skill routing` 헤딩 문자열의 존재 여부**뿐이다. 내용은 보지 않는다.

**결정** — 우리 라우팅 테이블을 **`## Skill routing` 헤딩으로 미리 써 둔다.**
gstack은 `HAS_ROUTING=yes`를 보고 자기 블록을 삽입하지 않는다. 삭제 경쟁이 사라진다.

이것이 P6("라우팅 소유권은 CLAUDE.md 한 곳")을 얻는 **기계적** 방법이다.
`CLAUDE.md` 참조. (폴백: `gstack-config set routing_declined true`)

### B4. 플랜 태스크 헤딩 형식은 강제 사항이다

`scripts/task-brief`의 태스크 추출 awk:

```awk
!infence && /^#+[ \t]+Task[ \t]+[0-9]+/ { intask = ($0 ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)")) }
```

`plan.md`의 태스크가 **`### Task N: ...` 헤딩**이 아니면 `task-brief`가 exit 3으로 실패하고
SDD 루프가 시작조차 못 한다. 명세 §4.2는 "각 태스크에 `[id] ...`"라고만 적어 이 제약을 놓쳤다.

**결정** — 계약 스키마 체커(§4.3)가 **빌드 시작 전에** 태스크 헤딩 형식을 검증한다.
2축 태그는 헤딩 **다음 줄의 메타 라인**으로 싣는다 (헤딩 형식을 깨지 않으려고).

### B5. SLUG 유도 방식이 스킬마다 다르다

| 스킬 | 유도 |
|---|---|
| `office-hours`, `plan-ceo-review` | `bin/gstack-slug` |
| `plan-eng-review` | `browse/bin/remote-slug` → 실패 시 `basename $(git rev-parse --show-toplevel)` |

실측: 이 레포에서 둘 다 `engineer-bot`으로 수렴한다. 다만 **동일 슬러그를 전제하지 말고**
`bin/setup-paths.sh`가 두 방식의 결과를 비교해 불일치 시 경고한다.

---

### B6. 경로 계약(B2)이 SDD 워크스페이스 분리를 무력화한다 (2026-09-03 실측)

`scripts/sdd-workspace` 는 워크스페이스 디렉터리를 **플랜 파일의 basename** 으로 만든다:

```
docs/plans/feature-a/plan.md  →  .superpowers/sdd/plan/
docs/plans/feature-b/plan.md  →  .superpowers/sdd/plan/     ← 같은 곳
```

그런데 명세 §4.1(B2 정규화)은 **모든** 플랜을 `docs/plans/<slug>/plan.md` 로 고정한다.
즉 이 레포의 모든 기능이 **단 하나의 워크스페이스를 공유한다.**

업스트림은 워크스페이스를 플랜 단위로 분리한다고 전제하고(A5: "플랜 단위로 만들고
최종 리뷰가 깨끗해지면 삭제한다"), `task-N-brief.md`·`task-N-report.md`·리뷰 패키지가
전부 `task-N-*` 로 명명된다. **두 번째 기능을 빌드하면 이전 기능의 `task-1-brief.md` 를
읽을 수 있다.**

현재 유일한 방어선은 ledger 첫 줄의 플랜 경로 대조다 — 스킬이 "다른 플랜의 ledger 면
그대로 두고 새로 시작하라"고 지시한다. 그것은 ledger 파일 하나만 보호하고 브리프·리포트는
보호하지 않는다.

| | 결정 |
|---|---|
| **판정** | B2 가 파일명을 고정한 대가다. 계약을 만들 때 **업스트림이 파일명으로 무언가를 구분한다**는 것을 놓쳤다 |
| **채택** | `bin/builder` 가 세션 기동 전에 `.superpowers/sdd/` 아래 다른 플랜의 잔여물이 있으면 **경고하거나 슬러그별로 격리**한다. 원본 스킬은 고치지 않는다 (P4) |
| 현재 상태 | **미구현.** 플랜이 하나뿐이라 아직 터지지 않는다. 두 번째 기능 착수 전에 처리해야 한다 |
| 실측 출처 | 3회전 `discoveries.md` — 봇이 스스로 찾아 기록했다 |


## A′. superpowers 6.3.0 재실측 (2026-09-02)

> A1~A6은 **6.2.0** 실측이다. 2026-09-02 재실측 결과 이 호스트에서 실제로 로드되는 버전은
> **6.3.0** — 그것도 릴리스 태그가 아니라 `dev` **브랜치 체크아웃**이다.
>
> 6.3.0은 A3이 전제한 사람 질문 지점을 **업스트림이 직접 제거**했다. A3의 변환 작업이 불필요해진
> 대신, **플랜 결함을 SDD가 스스로 판결하고 진행하는** 새 동작이 들어왔다 — 명세 §6.3과 게이트 ①에
> 정면으로 충돌한다. **A7의 버전 결정이 A8~A12의 적용 여부를 결정한다.**

### A7. 동일 이름 플러그인 2개가 동시 활성 — versions.lock이 가리킬 대상이 모호하다

| settings.json 항목 | 캐시 경로 | plugin.json `name` | version | 형태 |
|---|---|---|---|---|
| `superpowers@superpowers-marketplace` | `.../superpowers/6.2.0` | `superpowers` | 6.2.0 | 릴리스 |
| `superpowers-dev@superpowers-marketplace` | `.../superpowers-dev/6.3.0` | **`superpowers`** | 6.3.0 | **`dev` 브랜치 체크아웃** (sha `fd02874`, dirty 1) |

`~/.claude/settings.json`에서 **둘 다 `true`**다. 두 플러그인이 같은 `name`을 선언하므로
`superpowers:subagent-driven-development`가 어느 쪽으로 해석되는지 하네스가 통제하지 못한다.

**이 세션의 실제 해석은 6.3.0이다** — 인라인된 `using-superpowers`에 `Hermes Agent` 행이 있고
그 행은 6.3.0에만 존재한다 (6.2.0 grep 0건). 다만 `.in_use` 락 파일은 **6.2.0 쪽에만** 쌓여 있어
**세션마다 달라질 수 있다.** 이것이 재현성 파손의 실제 형태다.

| | 결정 |
|---|---|
| **채택** | 봇 호스트는 **한 쪽만 켠다.** 어느 쪽인지는 아래 판정 |
| **권고** | **6.2.0 (릴리스) 유지 — `superpowers-dev`를 끈다** |
| ✅ **해소됨 (2026-09-03)** | `superpowers-dev@superpowers-marketplace`가 `false`로 내려갔다. `./bootstrap.sh check` → *"활성 플러그인 중 이름 충돌 없음"*. `versions.lock`의 superpowers 항목을 한 줄로 줄였고, 이제 그 핀이 실제로 가리킬 대상이 하나다. **A8~A13은 6.3.0을 고를 경우의 판정이었으므로 적용되지 않는다** — A3의 "질문 → 반송" 변환 오버레이가 계속 유효하다 |
| 근거 | ① `dev` 브랜치는 이동하는 타깃이다. BUILD-PLAN §0-A가 gstack을 `--no-team`으로 설치한 것과 같은 이유로 봇에 부적합하다 ② **6.2.0의 실패 모델이 이 명세와 정합한다** — 플랜 결함을 사람에게 올리는 동작이 §6.3 반송과 1:1로 맞고, A3 오버레이가 이미 작성돼 있다 ③ 6.3.0의 "Rulings, not stalls" 철학은 게이트 ①의 설계 의도와 반대 방향이다 (A9) |
| 대가 | 6.3.0의 headless 친화 변경을 포기한다. A3 변환 오버레이가 계속 필요하다 (이미 있으므로 추가 비용 0) |
| 적용 | `~/.claude/settings.json` — `"superpowers-dev@superpowers-marketplace": false`. `bootstrap.sh check`에 **중복 이름 플러그인 탐지**를 추가한다 |

### A8. A3 폐기 — 업스트림이 사람 질문 지점을 스스로 제거했다 (6.3.0 채택 시)

A3은 6.2.0 SDD의 사람 질문 2지점을 `REJECTED` 반송으로 변환하는 오버레이였다.
6.3.0은 그 지점들을 **원문에서 삭제**했다:

| 6.2.0 원문 | 6.3.0 |
|---|---|
| `## Setup`: "Present everything you find to your human partner as **one batched question**" | 삭제 → "**Rule on** everything you find before execution begins... record each ruling in the ledger" |
| fix loop: "is **the human's decision**... ask which governs" | 삭제 → "is **yours to rule on**... with the spec as the binding authority" |
| 브레이커: "Real and load-bearing: **STOP**... report to your human partner" | 삭제 → "rule on the smallest change that unblocks the dependent work... **Stop only when** every path forward is a guess" |
| 에스컬레이션 4: "If the plan itself is wrong, **escalate to the human**" | 삭제 → "**rule on the correction**, ledger it, and re-dispatch with the ruling" |

6.3.0이 새로 명시한 **stop 조건은 4개뿐**이다: 되돌릴 수 없거나 파괴적인 작업 · 보안 민감 작업 ·
worktree 밖 side effect(**merge · 공유 브랜치 push · publish**) · 모든 경로가 추측인 플랜.

| | 결정 |
|---|---|
| **채택 (6.3.0 선택 시)** | A3의 "질문 → 반송" 변환 지시를 **제거한다.** 억제할 질문이 없다 |
| **주의** | 3번째 stop 조건이 headless에서 위험하다. **PR 생성이 "a publish"로 해석되면 세션이 멈춘다** — 타임아웃(4h)까지 대기한다. 오버레이가 "이 브랜치의 push와 PR 생성은 승인된 작업이며 stop 조건이 아니다"를 명시해야 한다 |

### A9. 6.3.0은 플랜 결함을 스스로 판결한다 — 명세 §6.3 · 게이트 ① 충돌 (6.3.0 채택 시)

6.3.0 서두:

> **Rulings, not stalls.** ... Conflicts, ambiguities, **plan defects**, a cap you would have asked
> to exceed — decide them. ... A session parked on a question costs their whole day and buys nothing.

명세 §6.3은 정확히 그 반대다 — "빌드 중 플랜 결함 발견 시 **반송, 현장 수정 금지**. 근거: SDD는
틀린 플랜도 끝까지 완주하는 도구다. 플랜 수정 권한을 builder에 주면 게이트 ①이 무력화된다."

**6.3.0은 그 권한을 기본값으로 부여한다.** 승인된 플랜과 다른 것이 빌드되고, 그 차이가 ledger의
`Ruling:` 줄에만 남는다.

| | 결정 |
|---|---|
| **채택 (6.3.0 선택 시)** | 명세 §6.3을 **유지**한다. 오버레이가 "플랜 결함은 판결 대상이 아니라 `REJECTED` 반송이다"를 A3보다 **더 강하게** 명시해야 한다 |
| 위험 | 이것은 스킬의 **새 핵심 지시를 억제**하는 것이다 — A1이 "오버레이로 스킬의 핵심 루프를 억제하는 것은 사실상 fork"라고 판정한 그 상황이다. A1의 논리를 따르면 **6.3.0을 받아들이는 비용이 6.2.0 유지보다 크다** → A7 권고의 세 번째 근거 |
| 완화 지렛대 | **writing-plans의 새 `**Spec:**` 필드** (A11). SDD 6.3.0은 "the spec is the **binding authority**, the plan is its argument"라고 하고, "A plan with no reachable spec gets a ledger note saying so — **rulings made without one are provisional**"이라고 한다. `Spec: docs/plans/<slug>/design-doc.md`를 채우면 판결이 design-doc에 종속된다 — 무제한 판결보다 낫다 |

### A10. `Rulings I made` 목록이 최종 메시지로만 나간다 — A6 계약에서 유실된다

6.3.0 `## Finish`:

> collect every ledger line containing `Ruling:` ... into **your final message** under "Rulings I made"
> ... That list is **the only place** the decisions you took on your human partner's behalf reach them

A6은 `claude -p` stdout을 파싱하지 않기로 했다 (파일 + JSON 스키마만). 그러면
**판결 기록이 전부 사라진다.** 워크스페이스도 최종 리뷰 후 삭제되므로(A5) ledger도 함께 사라진다.

| | 결정 |
|---|---|
| **채택** | 두 곳에 이중으로 남긴다: ① `docs/plans/<slug>/discoveries.md`에 `Ruling:` 줄 누적 (A5와 같은 이유) ② `build-result.json`에 `rulings[]` 필드 추가 — 각 항목에 `task_id`, `decision`, `why`, `cost_if_wrong` |
| 근거 | 게이트 ②에서 사람이 머지를 판단하려면 "봇이 나를 대신해 무엇을 결정했는가"가 보고 패킷에 있어야 한다. 최종 메시지에만 있으면 A6의 경계에서 버려진다 |
| 적용 | `controller/contract.ts` (스키마) · `controller/report.ts` (패킷에 노출) · `overlay/CLAUDE.builder.md` (쓰기 의무) |

### A11. `writing-plans`에 `**Spec:**` 필드가 추가됐다 — 계약 필수 항목이다

6.3.0 `writing-plans` diff 전부가 이 한 항목이다:

```
**Spec:** [path to the spec/design doc this plan implements — the plan
argues from the spec, so the spec travels with it; executors read both]
```

| | 결정 |
|---|---|
| **채택** | `plan.md`의 `**Spec:**`은 **반드시** `docs/plans/<slug>/design-doc.md`여야 한다. 계약 스키마 체커가 빌드 시작 전에 검증한다 (§4.3) |
| 근거 | 6.3.0에서 이 필드가 판결의 근거를 결정한다 (A9 완화 지렛대). 비어 있으면 모든 판결이 `provisional`이 되고, 승인된 플랜과 빌드된 결과의 관계를 추적할 수 없다. 6.2.0에서는 무해하므로 **어느 버전을 고르든 넣는다** |
| 적용 | `controller/contract.ts` · `overlay/writing-plans-tagging.md` |

### A12. 배치 디스패치 — 플랜 태스크 수 ≠ 서브에이전트 디스패치 수 (6.3.0 채택 시)

6.3.0 `## The Task Loop` 신규:

> **Batch small same-shape work.** ... do not dispatch one subagent per task. Compose ONE dispatch
> brief listing every file and its change, send the whole batch to a single subagent

명세 §5.2-1("태스크를 순서대로 큐잉, 완료 게이트 통과해야 다음")과 §5.2-2("태스크마다 fresh subagent")의
전제가 깨진다. `build-result.json`의 태스크별 보고도 영향을 받는다.

| | 결정 |
|---|---|
| **채택 (6.3.0 선택 시)** | 업스트림 배치를 허용한다. 다만 **보고는 태스크 단위를 유지한다** — 배치 안의 각 `Task N`이 `tasks[]`에 개별 항목으로 남아야 한다. 배치는 실행 최적화이고 보고 단위가 아니다 |
| 적용 | `overlay/CLAUDE.builder.md` |

### A13. `finishing-a-development-branch`에 새 사람 질문 지점 — 컨트롤러가 worktree를 소유해야 한다

6.3.0 신규: worktree 제거가 `contains modified or untracked files`로 거부되면
"Never `--force` on your own initiative. **Show your human partner** what is at stake and ask" —
3択 질문을 던지고 대기한다. headless에서는 타임아웃까지 멈춘다.

| | 결정 |
|---|---|
| **채택** | **컨트롤러가 세션마다 worktree를 만들고 소유한다.** `TARGET_REPO`를 그 worktree로 넘긴다. SDD Setup의 "create one **or verify the existing one**"이 검증 경로를 타므로 SDD는 worktree를 만들지도 지우지도 않는다 |
| 부수 효과 | `bin/builder`의 "현재 브랜치 == 승인 브랜치" 제약(레포당 동시 1세션)이 풀린다 → 여러 기능을 병렬로 돌릴 수 있다 |
| 적용 | `controller/worktree.ts` (신규) · `bin/builder` · `overlay/CLAUDE.builder.md` |

---

### A14. 기획 라우팅 교체 — `/office-hours` → `superpowers:brainstorming` (2026-09-03)

**명세 §3.3 원문**: *"신규 기획 요청은 `/office-hours`로 라우팅 (superpowers brainstorming 사용 안 함)"*
**명세 P6 근거**: 두 플러그인이 같은 트리거를 자기 기획 스킬로 가져가는 충돌 방지.

사용자 판단 (2026-09-03): *"프로덕트를 처음부터 만드는 거라기보다는 기획적인 차원을 더 보는 게
맞는 거 같아서 office-hours, plan-ceo-review는 제외하고 gstack/plan-design-review랑
superpowers/brainstorming 이걸 넣는 게 더 도움이 될 거 같아."*

| | 결정 |
|---|---|
| **채택** | 기획 진입점을 `superpowers:brainstorming`으로 바꾼다. `/office-hours`·`/plan-ceo-review`를 라우팅에서 뺀다. `/plan-design-review`를 넣는다 |
| 근거 | ① `/office-hours`는 **0에서 제품을 발굴하는** 소크라테스 문답이다. 이 팀의 작업은 "이미 있는 아이디어를 설계로"에 가깝다 ② brainstorming의 **경로 분류**(spike / bounded / architectural)가 그 형태와 맞고, 매번 같은 무게의 기획 의식을 강요하지 않는다 ③ brainstorming은 **접근안 2~3개를 트레이드오프와 함께** 내므로 `plan-ceo-review`의 도전 층을 부분적으로 흡수한다 |
| **대가** | **스코프·전제를 정면으로 도전하는 전용 층이 사라진다.** brainstorming의 질문은 "무엇을 만들까"에 집중하고, ceo-review처럼 "이걸 왜 만드나 / 안 만들면 안 되나"를 밀어붙이지 않는다. 되돌리려면 CLAUDE.md의 해당 행 하나만 복구하면 된다 |
| **부수 효과 — 방향이 뒤집힌다** | B2의 `materialize`는 **gstack 명명 → 계약 경로** 방향이었다. brainstorming은 `docs/plans/<slug>/design-doc.md`에 **직접 쓰므로** 그 방향이 필요 없어진다. 대신 **역방향이 필요해진다**: `/plan-eng-review`가 설계문서를 `~/.gstack/projects/$SLUG/*-$BRANCH-design-*.md`로 **glob 탐색**하므로(B1 — 하드코딩), 계약 경로의 `design-doc.md`를 gstack 명명으로 **내보내야** 그 스킬이 자기 입력을 찾는다. `controller/materialize.ts`에 `--export` 방향을 추가해야 한다 (미구현) |
| 미구현으로 인한 현재 상태 | **`/plan-eng-review`를 쓰려면 손으로 복사해야 한다.** `cp docs/plans/<slug>/design-doc.md docs/gstack/$(whoami)-<slug>-design-$(date +%Y%m%d%H%M%S).md`. 선행 조건으로 `bin/setup-paths.sh`가 그 레포에서 한 번 돌아야 한다 (심링크). 자동화 전까지 이 단계가 사람 개입 지점이다 |
| ⚠️ **양방향 위험 — 자동화 시 반드시 막을 것** | export 와 materialize 는 **서로 반대 방향**이고, 사이에 편집이 끼면 덮어쓴다: `export`(design-doc → gstack) → **design-doc.md 편집** → `materialize`(gstack 최신 → design-doc) 하면 **편집이 사라진다.** materialize 는 `ls -t`로 최신 파일을 고르는데, 그 최신 파일이 편집 이전의 export 사본이기 때문이다. `--export` 구현 시 방향을 하나 고르게 강제하거나(양쪽 해시 비교 후 최신이 아닌 쪽으로 덮어쓰기를 거부), 최소한 덮어쓰기 전 diff 를 보여야 한다 |
| 주의 | **`## Skill routing` 헤딩 문자열은 그대로 유지한다** (B3). gstack이 자기 블록을 삽입하지 않도록 막는 유일한 장치이고, 판정이 헤딩 존재 여부뿐이므로 내용은 자유롭게 바꿔도 된다 |
| 실측 | `/plan-design-review`는 `allowed-tools`에 `Edit`·`AskUserQuestion`을 갖고 **플랜을 직접 고친다** (*"then fixes the plan to get there"*). 게이트 ① **앞**이고 대화형이므로 하드룰 #2와 충돌하지 않는다 — 승인 전 + 사람이 결정하는 자리다 (feature/plan-preflight 설계 §6.4와 같은 논리) |
| 적용 | `CLAUDE.md` — dispatcher 규칙 · 라우팅 테이블 · "쓰지 않는 스킬" 표 |

### A15. 핀할 수 없는 스킬이 파이프라인에 들어온다 — `qa-planning` (2026-09-03)

세션 **도중에** `qa-planning`이 사용 가능해졌다. 시작 시점 스킬 목록에는 없었다.

실측:

| 확인 | 결과 |
|---|---|
| 로컬 디스크(`~/.claude`, `~/Documents`) | **없음** |
| `anthropics/skills` 공식 레포의 스킬 목록 | **없음** (webapp-testing은 있다) |
| `SearchSkills` 카탈로그 | 결과 0건 |
| 출처 | **사용자가 claude.ai에 등록한 스킬**이 이 세션에 동기화된 것 |

| | 결정 |
|---|---|
| **채택** | claude.ai 등록 스킬은 **`versions.lock`이 기록할 수 없다.** 파일이 없으므로 sha도 버전도 없다. 이 스킬에 의존하는 파이프라인 구간은 **재현성 계약 밖**이다 |
| 근거 | A7과 같은 종류의 문제다. 그때는 플러그인 2개가 같은 이름을 선언해 versions.lock의 대상이 모호해졌고, 여기서는 대상 자체가 파일로 존재하지 않는다 |
| 대응 | 봇 호스트에서 돌려야 하는 스킬은 **레포에 vendoring한다** (`.claude/skills/<name>/`, git 추적). claude.ai 등록본은 사람이 대화형으로 쓸 때만 의존한다 |
| 미결 | `qa-planning`의 산출물 `QA_PLAN.md`는 경로가 지정돼 있지 않다 → B2와 같은 정규화 문제. 배치(기획 단계 vs 게이트 ② 전)도 미정. `docs/plans/feature-plan-preflight/design-doc.md` §1.1.1 참조 |
| 적용 | ✅ 구현됨 (2026-09-03) — `config/vendored-skills.json`(매니페스트) · `controller/vendored.ts`(검증, 테스트 14개) · `bootstrap.sh check_vendored_skills` |

**vendoring 계약** — 등재된 스킬은 업스트림과 **바이트 단위로 같아야 한다.**
해시는 **git blob sha1**이라 `git hash-object <파일>`로 사람이 직접 확인할 수 있고,
GitHub 트리 API 값과 그대로 대조된다. 해시가 어긋나면 둘 중 하나다 — 누가 사본을 고쳤거나
(= 몰래 fork했거나, 명세 P4 위반), 업스트림을 올리고 매니페스트를 갱신하지 않았거나.
드리프트 탐지는 실측으로 확인했다 (파일 한 줄 추가 → `exit 1` + 변경 파일 지목 → 되돌리니 통과).

**첫 등재: `webapp-testing`** (`anthropics/skills` sha `5304866`, 6개 파일).
실측에서 드러난 함정 하나 — **Python playwright에는 `1.58.2`가 없다.** Node는 1.58.2,
Python은 1.58.0이 최신이다. 다행히 두 버전 다 **chromium 리비전 1208**을 쓰므로
(`microsoft/playwright` `browsers.json` 실측) gstack의 node playwright와 브라우저를 공유하고,
설치해도 공유 캐시에 리비전이 늘지 않았다. **버전을 안 맞추면 2026-07-30 `bootstrap repair`가
고쳐야 했던 상태(1208 vs 1228 불일치)가 재발한다.**


## C. 남은 미결 (사용자 입력 대기)

| # | 항목 | 막는 것 |
|---|---|---|
| I1~I5 | 호스트 · Claude 인증 · Slack 수신 방식 · 상태 저장소 · GitHub 자격증명 | Phase 2 실운영. 코드는 환경변수로 전부 추상화해 뒀다 (`.env.example`) |
| I6 | Phase 0-B 대상 기능 1개 | **end-to-end 1회전 검증.** 컨트롤러는 단위 테스트까지만 검증됨 |
| A1 재검증 | 리뷰어 구조 수용 후 실제 실행시간·비용 | 1회전 후 측정 → 필요하면 A1 재논의 |

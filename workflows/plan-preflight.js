export const meta = {
  name: 'plan-preflight',
  description: '게이트 ① 앞에서 계획서의 할 일 간 모순을 찾는다 (2단계 AI 검사)',
  phases: [
    { title: 'Candidates', detail: '1단계가 넘긴 서명 후보 판정' },
    { title: 'Undeclared', detail: '선언되지 않은 충돌 탐색' },
    { title: 'Critic', detail: '완결성 검사관 — 놓친 관계' },
    { title: 'Verify', detail: '반증 — 애매하면 결함이 아니다' },
    { title: 'Fix', detail: '살아남은 결함의 수정 패치' },
  ],
}

// args = bin/preflight <branch> --plan 의 출력
// { planPath, rawPath, planSha256, relationsDeclared,
//   stage1Defects[], stage2Candidates[], pairs[] }
//
// 이 스크립트는 파일을 읽을 수 없다 (플랫폼 제약). 판단 로직도 두지 않는다 —
// controller/preflight.ts 가 그것을 갖는다 (설계 D1). 여기 있는 것은
// agent() 호출과 결과 수집뿐이다.
//
// 모델은 모든 호출에 명시한다 (하드룰 #3 · 설계 D19). 워크플로우 레퍼런스는
// 생략을 기본으로 하지만, 에이전트가 20개 넘게 뜨는 곳에서 생략하면 세션
// 모델을 상속해 티어 정책이 조용히 무력화된다.

const DEFECT_SCHEMA = {
  type: 'object',
  required: ['defects'],
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'task_ids', 'plan_text', 'conflict', 'stage'],
        properties: {
          id: { type: 'string' },
          kind: { enum: ['dangling_ref', 'order_violation', 'signature_mismatch', 'undeclared_conflict'] },
          task_ids: { type: 'array', items: { type: 'string' }, minItems: 2 },
          relation: { type: 'string' },
          plan_text: { type: 'string' },
          conflict: { type: 'string' },
          stage: { enum: [1, 2] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'why'],
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
}

const PATCH_SCHEMA = {
  type: 'object',
  required: ['op', 'task_id', 'anchor', 'text'],
  properties: {
    op: { enum: ['insert_after', 'replace'] },
    task_id: { type: 'string' },
    anchor: { type: 'string' },
    text: { type: 'string' },
  },
}

const PLAN = args.planPath
const examined = []
const failed = []

// ── 1) 서명 후보 판정 ────────────────────────────────────────────
phase('Candidates')
const sigResults = await parallel((args.stage2Candidates ?? []).map((c) => () =>
  agent(
    `${PLAN} 의 Task ${c.task_ids[0]} 과 Task ${c.task_ids[1]} 는 심볼 \`${c.relation}\` 의\n` +
    `서명이 텍스트로 다르다:\n${c.plan_text}\n\n` +
    `표기만 다른가, 실제로 타입이 안 맞는가? 실제로 안 맞을 때만 결함으로 보고하라.\n` +
    `보고할 때 id 는 "${c.id}" 를 그대로 쓰고 stage 는 2 로 한다.`,
    { label: `sig:${c.id}`, phase: 'Candidates', schema: DEFECT_SCHEMA, model: 'sonnet' },
  ).then((r) => { examined.push(`sig:${c.id}`); return r })
    .catch(() => { failed.push(`sig:${c.id}`); return null })))

// ── 2) 선언되지 않은 충돌 탐색 (파일 겹침 짝마다) ────────────────
phase('Undeclared')
const pairResults = await parallel((args.pairs ?? []).map((p) => () => {
  const unit = `pair:${p.a}x${p.b}`
  return agent(
    `${PLAN} 의 Task ${p.a} 와 Task ${p.b} 는 다음 파일을 함께 건드린다:\n` +
    `${p.sharedFiles.join(', ')}\n\n` +
    `**Interfaces:** 에 선언되지 않았지만 실제로 충돌하는 것이 있는가?\n` +
    `예: 한쪽이 값을 어떤 형식으로 저장하고 다른 쪽이 다른 형식으로 읽는 경우.\n` +
    `선언된 관계는 이미 기계가 검사했으니 중복 보고하지 마라.\n` +
    `id 는 "${unit}-<번호>" 형식으로, kind 는 "undeclared_conflict", stage 는 2 로 한다.`,
    { label: unit, phase: 'Undeclared', schema: DEFECT_SCHEMA, model: 'opus' },
  ).then((r) => { examined.push(unit); return r })
    .catch(() => { failed.push(unit); return null })
}))

const found = [...sigResults, ...pairResults]
  .filter(Boolean)
  .flatMap((r) => r.defects ?? [])

// ── 3) 완결성 검사관 (설계 D17) ──────────────────────────────────
phase('Critic')
log(`검사 단위 ${examined.length}개 · 실패 ${failed.length}개 · 발견 ${found.length}건`)
const critic = await agent(
  `${PLAN} 전문을 읽어라. 지금까지 검사한 단위와 발견한 결함은 이렇다:\n` +
  `검사 단위: ${examined.join(', ') || '(없음)'}\n` +
  `발견: ${found.map((d) => `${d.id}(${d.task_ids.join('×')})`).join(', ') || '(없음)'}\n\n` +
  `**놓친 관계가 있는가?** 위 단위에 포함되지 않은 태스크 조합에서 모순을 찾아라.\n` +
  `id 는 "critic-<번호>", kind 는 "undeclared_conflict", stage 는 2 로 한다.`,
  { label: 'critic', phase: 'Critic', schema: DEFECT_SCHEMA, model: 'opus' },
).catch(() => { failed.push('critic'); return null })

const candidates = [...found, ...(critic?.defects ?? [])]

// ── 4) 반증 — 애매하면 결함이 아니다 (설계 D4) ───────────────────
phase('Verify')
const survivors = (await parallel(candidates.map((d) => () =>
  agent(
    `다음 주장을 반증하라: ${d.conflict}\n관련 태스크: ${d.task_ids.join(', ')}\n` +
    `인용된 플랜 원문: ${d.plan_text}\n\n` +
    `계획서 ${PLAN} 를 읽고 판단하라. **불확실하면 refuted=true 가 기본값이다.**\n` +
    `오탐이 정상 플랜을 반송시키는 것이 놓치는 것보다 비싸다.`,
    { label: `refute:${d.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: 'sonnet' },
  ).then((v) => (v && !v.refuted ? d : null)).catch(() => null))))
  .filter(Boolean)

// ── 5) 수정 패치 (설계 D24) ──────────────────────────────────────
phase('Fix')
const withPatch = await pipeline(
  survivors,
  (d) => agent(
    `계획서 ${PLAN} 의 다음 결함을 고칠 패치를 내라:\n${d.conflict}\n` +
    `관련 태스크: ${d.task_ids.join(', ')}\n\n` +
    `anchor 는 **task_id 로 지정한 태스크 본문 안에 실제로 존재하는 한 줄**이어야 한다.\n` +
    `text 는 그 자리에 들어갈 내용을 그대로 쓴다 — 사람이 승인한 텍스트가 그대로 삽입된다.`,
    { label: `fix:${d.id}`, phase: 'Fix', schema: PATCH_SCHEMA, model: 'sonnet' },
  ).then((patch) => ({ ...d, patch: patch ?? undefined })).catch(() => d),
)

return {
  schema: 1,
  plan_sha256: args.planSha256,
  stage1: { relations_declared: args.relationsDeclared, defects: args.stage1Defects ?? [] },
  stage2: { units_examined: examined, units_failed: failed, defects: withPatch },
  critic: { additional_defects: [] },
}

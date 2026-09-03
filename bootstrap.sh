#!/usr/bin/env bash
# engineer-bot 환경 부트스트랩 — gstack + superpowers 검증/수리/핀
#
#   ./bootstrap.sh check    읽기 전용 진단 (기본값)
#   ./bootstrap.sh repair   gstack 재빌드 + playwright 정렬 + superpowers 업그레이드
#   ./bootstrap.sh pin      현재 버전을 versions.lock 에 기록 (재현성)
#
# repair 는 사용자 전역 설정(~/.claude, ~/.gstack)을 건드립니다.
set -uo pipefail

MODE="${1:-check}"
GSTACK_DIR="$HOME/.claude/skills/gstack"
BROWSE_BIN="$GSTACK_DIR/browse/dist/browse"
SP_PLUGIN="superpowers@superpowers-marketplace"
LOCKFILE="$(cd "$(dirname "$0")" && pwd)/versions.lock"

FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ── 0. 전제 도구 ──────────────────────────────────────────────
check_prereqs() {
  head_ "전제 도구"
  local t
  for t in bun node git gh claude; do
    if command -v "$t" >/dev/null 2>&1; then
      ok "$t $("$t" --version 2>&1 | head -1 | tr -d '\n')"
    else
      bad "$t 없음 — 필수"
    fi
  done
}

# ── 1. gstack ─────────────────────────────────────────────────
check_gstack() {
  head_ "gstack"
  if [ ! -d "$GSTACK_DIR" ]; then
    bad "$GSTACK_DIR 없음 — 미설치. repair 모드로 클론하세요"
    return
  fi
  ok "설치 위치 $GSTACK_DIR"
  ok "버전 $(node -e "console.log(require('$GSTACK_DIR/package.json').version)" 2>/dev/null || echo '?')"
  ok "HEAD $(git -C "$GSTACK_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"

  # dist 바이너리가 체크아웃과 같은 커밋에서 빌드됐는지
  local dist_sha head_sha
  dist_sha="$(cat "$GSTACK_DIR/browse/dist/.version" 2>/dev/null || echo none)"
  head_sha="$(git -C "$GSTACK_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$dist_sha" = "$head_sha" ]; then
    ok "browse 바이너리 빌드 커밋 일치"
  else
    bad "browse 바이너리가 낡음 (dist=${dist_sha:0:7} vs HEAD=${head_sha:0:7}) — repair 필요"
  fi

  # 실제 실행 — playwright chromium 정렬 여부가 여기서 드러난다
  if [ -x "$BROWSE_BIN" ]; then
    local out
    out="$("$BROWSE_BIN" --version 2>&1 | head -5)"
    if printf '%s' "$out" | grep -qi "Executable doesn't exist"; then
      local want
      want="$(printf '%s' "$out" | grep -oE 'chromium_headless_shell-[0-9]+' | head -1)"
      bad "browse 실행 실패 — playwright $want 필요, 캐시에 없음"
      warn "캐시 보유: $(ls "$HOME/Library/Caches/ms-playwright" 2>/dev/null | grep headless_shell | tr '\n' ' ')"
      warn "→ visible 태스크 스크린샷(명세 §5.6-3)이 막힘. repair 로 해결"
    elif printf '%s' "$out" | grep -qiE 'failed|error'; then
      bad "browse 실행 실패: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
    else
      ok "browse 실행 가능"
    fi
  else
    bad "browse 바이너리 없음/실행권한 없음"
  fi
}

# ── 2. superpowers ────────────────────────────────────────────
check_superpowers() {
  head_ "superpowers"
  local ver
  ver="$(node -e '
    const p = require(process.env.HOME + "/.claude/plugins/installed_plugins.json");
    const e = p.plugins["superpowers@superpowers-marketplace"];
    console.log(e ? e[0].version + " " + (e[0].gitCommitSha || "") : "MISSING");
  ' 2>/dev/null || echo MISSING)"
  if [ "$ver" = "MISSING" ]; then
    bad "미설치 — repair 로 설치"
    return
  fi
  ok "버전 $ver"
  case "$ver" in
    5.1.*|5.[2-9].*|[6-9].*) ok "요구 버전 충족 (6.x는 AMENDMENTS A1~A6 참조)" ;;
    *) bad "명세는 5.1.x 이상 요구 — repair 로 업그레이드" ;;
  esac

  # 설치돼 있어도 enabledPlugins 에 없으면 세션에 로드되지 않는다.
  # 설치 상태와 활성화 상태는 다른 파일에 있다 — 둘 다 봐야 한다.
  local enabled
  enabled="$(node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.env.HOME + "/.claude/settings.json", "utf8"));
      console.log((s.enabledPlugins || {})["superpowers@superpowers-marketplace"] === true ? "yes" : "no");
    } catch { console.log("unknown"); }
  ' 2>/dev/null || echo unknown)"
  case "$enabled" in
    yes) ok "플러그인 활성화됨 (settings.json enabledPlugins)" ;;
    no)  bad "플러그인이 **비활성** 상태입니다 — 설치돼 있어도 세션에 로드되지 않습니다"
         warn "해결: claude plugin enable $SP_PLUGIN  (이후 Claude Code 재시작)" ;;
    *)   warn "활성화 상태를 판정할 수 없습니다 (settings.json 읽기 실패)" ;;
  esac

  # 명세가 의존하는 스킬이 실제로 있는지
  local dir s
  dir="$(node -e '
    const p = require(process.env.HOME + "/.claude/plugins/installed_plugins.json");
    console.log(p.plugins["superpowers@superpowers-marketplace"][0].installPath);
  ' 2>/dev/null)"
  for s in writing-plans subagent-driven-development test-driven-development; do
    [ -d "$dir/skills/$s" ] && ok "스킬 $s" || bad "스킬 $s 없음 (§3.1 / §5.1 의존)"
  done
}

# ── 2b. 플러그인 이름 충돌 (AMENDMENTS A7) ────────────────────
# 두 플러그인이 같은 plugin.json `name` 을 선언하고 둘 다 활성이면
# `superpowers:<skill>` 이 어느 쪽으로 해석되는지 통제할 수 없다.
# 2026-09-02 에 실제로 발생했다 (superpowers 6.2.0 + superpowers-dev 6.3.0).
# versions.lock 이 기록할 대상 자체가 모호해지므로 재현성 계약이 깨진다.
check_plugin_collisions() {
  head_ "플러그인 이름 충돌"
  local out
  out="$(node -e '
    const fs = require("fs"), path = require("path");
    const H = process.env.HOME;
    let settings = {}, installed = {};
    try { settings = JSON.parse(fs.readFileSync(H + "/.claude/settings.json", "utf8")); } catch {}
    try { installed = require(H + "/.claude/plugins/installed_plugins.json"); } catch {}
    const enabled = Object.entries(settings.enabledPlugins || {})
      .filter(([, v]) => v === true).map(([k]) => k);
    const byName = new Map();
    for (const key of enabled) {
      const e = (installed.plugins || {})[key];
      const p = e && e[0] && e[0].installPath;
      if (!p) continue;
      let name = null, version = null, branch = "";
      try {
        const m = JSON.parse(fs.readFileSync(path.join(p, ".claude-plugin", "plugin.json"), "utf8"));
        name = m.name; version = m.version;
      } catch { continue; }
      if (fs.existsSync(path.join(p, ".git"))) branch = " [git checkout — 이동하는 타깃]";
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(`${key} v${version}${branch}`);
    }
    const dups = [...byName].filter(([, v]) => v.length > 1);
    if (!dups.length) { console.log("CLEAN"); process.exit(0); }
    for (const [name, entries] of dups) {
      console.log("DUP\t" + name + "\t" + entries.join(" | "));
    }
  ' 2>/dev/null || echo ERR)"

  if [ "$out" = "CLEAN" ]; then
    ok "활성 플러그인 중 이름 충돌 없음"
    return
  fi
  if [ "$out" = "ERR" ]; then
    warn "판정 실패 (settings.json / installed_plugins.json 읽기 오류)"
    return
  fi
  while IFS=$'\t' read -r _ name entries; do
    bad "이름 '$name' 을 선언하는 활성 플러그인이 2개 이상: $entries"
  done <<< "$out"
  warn "해결: 한 쪽만 남기십시오 — claude plugin disable <중복 항목>"
  warn "      AMENDMENTS A7 참조. 봇 호스트에서는 릴리스 쪽을 남기는 것이 권고입니다."
}

# ── 2c. vendoring된 스킬 (AMENDMENTS A15) ─────────────────────
# 판정 로직은 controller/vendored.ts 에 있다 (테스트 14개). 여기서는 호출만 한다 —
# 셸에 로직을 두면 테스트할 수 없고, 이 레포는 판단을 controller/ 에 모은다.
check_vendored_skills() {
  head_ "vendoring된 스킬"
  local root out rc
  root="$(cd "$(dirname "$0")" && pwd)"
  if [ ! -f "$root/config/vendored-skills.json" ]; then
    warn "config/vendored-skills.json 없음 — vendoring된 스킬 없음"
    return
  fi
  out="$(bun "$root/controller/vendored.ts" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  [ $rc -ne 0 ] && FAIL=1
  return 0
}

# ── 3. 명세가 이식 대상으로 지정한 gstack 스킬 ────────────────
check_ported_skills() {
  head_ "이식 대상 스킬 (명세 §3.1)"
  local s
  for s in office-hours plan-ceo-review plan-eng-review; do
    [ -f "$HOME/.claude/skills/$s/SKILL.md" ] && ok "/$s" || bad "/$s 없음"
  done
}

# ── repair ────────────────────────────────────────────────────
do_repair() {
  head_ "repair — gstack"
  if [ ! -d "$GSTACK_DIR" ]; then
    git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$GSTACK_DIR" || return 1
  else
    git -C "$GSTACK_DIR" pull --depth 1 --ff-only || warn "pull 실패 — 기존 체크아웃으로 계속"
  fi

  # setup 이 bun install + browse 재빌드 + playwright chromium 설치까지 수행.
  # --no-team: 봇 호스트에서 조용한 자동 업데이트는 재현성을 깨므로 끈다 (P4 대응)
  ( cd "$GSTACK_DIR" && ./setup --no-team ) || { bad "gstack setup 실패"; return 1; }

  # setup 이 chromium 정렬을 못 잡는 경우의 폴백
  if "$BROWSE_BIN" --version 2>&1 | grep -qi "Executable doesn't exist"; then
    warn "playwright chromium 재설치 시도"
    ( cd "$GSTACK_DIR" && bunx playwright install chromium )
  fi

  head_ "repair — superpowers"
  claude plugin marketplace update superpowers-marketplace || warn "marketplace update 실패"
  claude plugin update "$SP_PLUGIN" || warn "plugin update 실패 — /plugin 으로 수동 확인"
  # 설치·업데이트는 활성화와 별개다. enable 없이는 세션에 로드되지 않는다.
  claude plugin enable "$SP_PLUGIN" || warn "plugin enable 실패"
  warn "플러그인 설치·활성화는 Claude Code 재시작 후 적용됩니다"
}

# ── pin ───────────────────────────────────────────────────────
do_pin() {
  head_ "pin → $LOCKFILE"
  {
    echo "# engineer-bot 환경 핀 — bootstrap.sh pin 으로 생성"
    echo "# 봇 호스트는 이 조합에서만 재현이 보장됩니다 (명세 P4/P5)"
    echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "claude_code=$(claude --version 2>&1 | head -1)"
    echo "bun=$(bun --version 2>&1)"
    echo "node=$(node --version 2>&1)"
    echo "gstack_version=$(node -e "console.log(require('$GSTACK_DIR/package.json').version)" 2>/dev/null)"
    echo "gstack_sha=$(git -C "$GSTACK_DIR" rev-parse HEAD 2>/dev/null)"
    node -e '
      const p = require(process.env.HOME + "/.claude/plugins/installed_plugins.json");
      const e = (p.plugins["superpowers@superpowers-marketplace"] || [])[0];
      if (e) { console.log("superpowers_version=" + e.version);
               console.log("superpowers_sha=" + (e.gitCommitSha || "")); }
    ' 2>/dev/null
  } > "$LOCKFILE"
  cat "$LOCKFILE"
}

# ── main ──────────────────────────────────────────────────────
case "$MODE" in
  check)
    check_prereqs; check_gstack; check_superpowers; check_plugin_collisions; check_vendored_skills; check_ported_skills
    head_ "결과"
    if [ "$FAIL" -eq 0 ]; then ok "이상 없음 — Phase 0 수동 1회전 진행 가능"
    else bad "문제 발견 — ./bootstrap.sh repair 실행"; fi
    exit "$FAIL"
    ;;
  repair)
    do_repair
    head_ "repair 후 재검사"
    FAIL=0; check_gstack; check_superpowers; check_plugin_collisions; check_vendored_skills
    exit "$FAIL"
    ;;
  pin) do_pin ;;
  *) echo "usage: $0 {check|repair|pin}" >&2; exit 2 ;;
esac

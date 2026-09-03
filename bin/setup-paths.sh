#!/usr/bin/env bash
# 경로 계약 배선 (명세 §4.1 · AMENDMENTS B1).
#
# gstack은 산출물을 ~/.gstack/projects/<slug>/ 에 쓴다. 두 봇이 같은 파일을
# 봐야 하므로(P7) 홈 디렉터리 산출은 금지다.
#
# GSTACK_HOME 환경변수만으로는 못 잡는다 — plan-eng-review가 설계문서 탐색과
# 테스트플랜 산출에서 ~/.gstack/projects 를 하드코딩한다 (AMENDMENTS B1).
# 심링크는 그 하드코딩까지 커버하는 유일한 수단이다.
#
#   ~/.gstack/projects/<slug>  →  <repo>/docs/gstack/
#
# 멱등하다. 제품 레포에서 실행한다:  bin/setup-paths.sh [repo-root]
set -uo pipefail

REPO_ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

if [ ! -d "$REPO_ROOT/.git" ]; then
  bad "git 레포가 아닙니다: $REPO_ROOT"
  exit 1
fi

# ── 슬러그 일치 확인 (AMENDMENTS B5) ──────────────────────────
# office-hours/ceo-review는 bin/gstack-slug 를, eng-review는 remote-slug →
# basename 폴백을 쓴다. 두 결과가 갈리면 산출물이 두 디렉터리로 흩어진다.
BASENAME_SLUG="$(basename "$REPO_ROOT")"
GSTACK_SLUG=""
if [ -x "$HOME/.claude/skills/gstack/bin/gstack-slug" ]; then
  # shellcheck disable=SC2016
  GSTACK_SLUG="$(cd "$REPO_ROOT" && eval "$("$HOME/.claude/skills/gstack/bin/gstack-slug" 2>/dev/null)" && printf '%s' "${SLUG:-}")"
fi

SLUG="${GSTACK_SLUG:-$BASENAME_SLUG}"
if [ -n "$GSTACK_SLUG" ] && [ "$GSTACK_SLUG" != "$BASENAME_SLUG" ]; then
  warn "슬러그 불일치: gstack-slug=$GSTACK_SLUG · basename=$BASENAME_SLUG"
  warn "두 스킬이 서로 다른 디렉터리를 볼 수 있습니다. 양쪽 심링크를 만듭니다"
fi

TARGET="$REPO_ROOT/docs/gstack"
mkdir -p "$TARGET" "$REPO_ROOT/docs/plans"
ok "산출 디렉터리 $TARGET"

link_one() {
  local slug="$1"
  local link="$GSTACK_HOME/projects/$slug"
  mkdir -p "$GSTACK_HOME/projects"

  if [ -L "$link" ]; then
    local current
    current="$(readlink "$link")"
    if [ "$current" = "$TARGET" ]; then
      ok "심링크 이미 정상: $link → $TARGET"
      return 0
    fi
    warn "심링크가 다른 곳을 봅니다: $link → $current"
    rm "$link"
  elif [ -d "$link" ]; then
    # 실제 디렉터리 — 기존 산출물이 있을 수 있으므로 지우지 않고 옮긴다
    if [ -n "$(ls -A "$link" 2>/dev/null)" ]; then
      warn "기존 산출물을 $TARGET 로 이동합니다"
      cp -Rn "$link"/. "$TARGET"/ 2>/dev/null || true
    fi
    mv "$link" "$link.pre-engineer-bot.$(date +%Y%m%d-%H%M%S)"
    ok "기존 디렉터리를 백업했습니다"
  elif [ -e "$link" ]; then
    bad "$link 이 디렉터리도 심링크도 아닙니다 — 수동 확인 필요"
    return 1
  fi

  ln -s "$TARGET" "$link"
  ok "심링크 생성: $link → $TARGET"
}

link_one "$SLUG" || exit 1
if [ -n "$GSTACK_SLUG" ] && [ "$GSTACK_SLUG" != "$BASENAME_SLUG" ]; then
  link_one "$BASENAME_SLUG" || exit 1
fi

# ── 검증 — 왕복 쓰기로 실제 도달을 확인한다 ───────────────────
PROBE="$GSTACK_HOME/projects/$SLUG/.setup-paths-probe"
if printf 'probe\n' > "$PROBE" 2>/dev/null && [ -f "$TARGET/.setup-paths-probe" ]; then
  rm -f "$PROBE"
  ok "왕복 확인 — gstack 산출물이 레포 안에 떨어집니다"
else
  rm -f "$PROBE" 2>/dev/null
  bad "왕복 실패 — 심링크가 작동하지 않습니다"
  exit 1
fi

# ── .gitignore 안내 ──────────────────────────────────────────
if ! grep -qE '^\.superpowers/?$' "$REPO_ROOT/.gitignore" 2>/dev/null; then
  warn "제품 레포 .gitignore 에 '.superpowers/' 가 없습니다 (SDD가 자체 .gitignore를 만들지만 확인 권장)"
fi

printf '\n다음: bun controller/materialize.ts <branch>\n'

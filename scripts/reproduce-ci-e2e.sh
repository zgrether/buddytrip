#!/usr/bin/env bash
# Reproduce CI's E2E job locally — the environment that found #1590.
#
#   scripts/reproduce-ci-e2e.sh [playwright args…]   build + run (e.g. --project=chat-action --retries=0 --repeat-each=4)
#   scripts/reproduce-ci-e2e.sh test [playwright args…]   re-run against the existing build (after `run`)
#   scripts/reproduce-ci-e2e.sh reset                 fresh database again, same build
#   scripts/reproduce-ci-e2e.sh stop                  tear the scratch stack down
#
# WHY: CI builds a FRESH database from the migrations on every run and serves a
# PRODUCTION build; local dev runs `next dev` against a long-lived database. A
# failure that lives in that difference cannot be reproduced locally any other
# way — #1590's shell remount failed every CI attempt and almost never locally,
# until this setup reproduced it 9 times in 12.
#
# WHAT IT DOES:
#   1. A SEPARATE Supabase stack (its own project id and ports, 573xx) in a
#      scratch directory, built from THIS tree's migrations (and roles.sql, as CI
#      does). The shared dev stack (`supabase_*_buddytrip`) is never touched —
#      other sessions use it, and resetting it would wipe their data (CLAUDE.md).
#   2. A production build (`npm run build`) pointed at that stack.
#   3. Playwright with CI's settings: CI=1 (workers 1, retries 2, the prod server)
#      on E2E_PORT (default 3100).
# CI's pinned CLI version and its `-x` container exclusions are read from
# .github/workflows/ci.yml, so this cannot drift from CI.
#
# CAUTION — THE BUILD REPLACES .next: stop your dev server first. Afterwards
# `rm -rf .next` before restarting it: this build has the scratch stack's URL
# baked in (NEXT_PUBLIC_* are inlined at build time).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
WORK=${CI_REPRO_DIR:-"${TMPDIR:-/tmp}/buddytrip-ci-repro"}
APP_PORT=${E2E_PORT:-3100}
CI_YML="$ROOT/.github/workflows/ci.yml"
CLI_VERSION=$(grep -A4 "supabase/setup-cli" "$CI_YML" | grep -m1 -oE "version: [0-9.]+" | cut -d" " -f2)
EXCLUDE=$(grep -m1 -oE "supabase start -x [a-z,-]+" "$CI_YML" | sed 's/^supabase start -x //')
[ -n "$CLI_VERSION" ] && [ -n "$EXCLUDE" ] || { echo "could not read the CLI pin / exclusions from ci.yml" >&2; exit 1; }
SB() { (cd "$WORK" && npx --yes "supabase@$CLI_VERSION" "$@"); }

prepare() {
  rm -rf "$WORK/supabase"
  mkdir -p "$WORK/supabase"
  cp "$ROOT/supabase/config.toml" "$WORK/supabase/"
  cp -r "$ROOT/supabase/migrations" "$WORK/supabase/"
  rm -rf "$WORK/supabase/migrations/_archive"
  [ -f "$ROOT/supabase/roles.sql" ] && cp "$ROOT/supabase/roles.sql" "$WORK/supabase/"
  # Own project id (own containers) and ports 543xx -> 573xx.
  sed -i 's/^project_id = .*/project_id = "bt-ci-repro"/' "$WORK/supabase/config.toml"
  sed -i 's/= 543\([0-9][0-9]\)/= 573\1/g; s/inspector_port = [0-9]*/inspector_port = 9183/' "$WORK/supabase/config.toml"
}

stack_env() {
  local env
  env=$(SB status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')
  eval "$env"
  export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
         SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" NEXT_PUBLIC_SITE_URL="http://localhost:$APP_PORT"
  echo "scratch stack: $NEXT_PUBLIC_SUPABASE_URL"
}

fresh_db() {
  if SB status >/dev/null 2>&1; then
    SB db reset
  else
    SB start -x "$EXCLUDE"
  fi
}

run_tests() {
  stack_env
  (cd "$ROOT" && CI=1 E2E_PORT="$APP_PORT" npx playwright test "$@")
}

cmd=${1:-run}
case "$cmd" in
  stop)  SB stop --no-backup; exit 0 ;;
  reset) shift; fresh_db; exit 0 ;;
  test)  shift; run_tests "$@"; exit $? ;;
  run)   shift || true ;;
  *)     ;; # anything else is a playwright arg for `run`
esac

prepare
fresh_db
stack_env
echo "building against the scratch stack (replaces .next — is your dev server stopped?)"
(cd "$ROOT" && rm -rf .next && npm run build)
run_tests "$@"

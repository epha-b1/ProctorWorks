#!/bin/bash
#
# audit_report-2 (test fixer pass) — false-pass banner fix.
#
# The previous wrapper had two latent bugs that combined into the
# observed "Jest reports 2 failed tests but wrapper prints ALL TESTS
# PASSED" contradiction:
#
#   1. `run_unit_tests` / `run_api_tests` ended with `echo ""`. In
#      bash, a function's exit status is the exit status of its LAST
#      command. `echo` always returns 0, so the function returned 0
#      even when jest had just exited non-zero. The `|| UNIT_EXIT=$?`
#      / `|| API_EXIT=$?` capture below was therefore dead code on
#      every failing run.
#
#   2. The script used `set -e` only — no `pipefail`, no `nounset`.
#      With `2>&1` redirects on the docker-compose exec lines, any
#      failure in the middle of a pipeline (which there were not, but
#      easily could be) would also have been swallowed.
#
# Fix:
#   - `set -euo pipefail` for fail-fast + pipeline-aware exits.
#   - Capture jest exit codes EXPLICITLY inside each function via
#     `|| local rc=$?` and `return $rc`, so the wrapper sees the real
#     status instead of `echo`'s 0.
#   - The pass banner now appears ONLY when both UNIT_EXIT and
#     API_EXIT are 0. Any non-zero exits with the failing-suite
#     summary and a non-zero exit code.
set -euo pipefail

echo "========================================"
echo "  ProctorWorks Test Suite"
echo "========================================"
echo ""

DB_URL="postgres://proctorworks:proctorworks@db:5432/proctorworks"
HEALTH_URL="http://localhost:3000/health"
# Black-box E2E suite hits the running API over HTTP. Because jest runs
# inside the `api` container via `docker compose exec`, `localhost:3000`
# is the container's own listener and no port forwarding is required.
E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
MAX_WAIT=60
RESET_ATTEMPTED=0

# ── Ensure containers are running ──────────────────────────────────────────────
#
# audit_report-2 (test fixer pass) — stale-image trap fix.
#
# The previous version of this function had a fast path that
# skipped the rebuild whenever containers were already healthy:
#
#     else
#       echo "[1/4] Containers already running ✓"
#     fi
#
# That was the trap behind the "tests pass when run via the
# wrapper but fail in CI" gap: if you edited source files and
# re-ran the wrapper without first stopping the container, the
# wrapper happily reused the OLD image (because the bind-mount
# pattern is not used here — the Dockerfile copies source at
# build time and runs `npm run build`). Tests then ran against
# stale compiled `dist/`, missing whatever fix you had just made.
#
# Fix: ALWAYS invoke `docker compose up -d --build` on every run.
# This is cheap when nothing changed (Docker's COPY layer hashes
# the source tree and reuses cached layers when unchanged) and
# correct when source did change (the COPY hash differs, layers
# rebuild from that point, and docker compose `up -d` recreates
# the container if the resulting image hash differs from the
# running one).
#
# An optional `SKIP_REBUILD=1` env var lets local devs skip the
# rebuild for fast iteration when they know the container image
# is fresh — but it is OFF BY DEFAULT so CI never falls into the
# stale-image trap.
ensure_containers() {
  local api_running
  api_running=$(docker compose ps --status running 2>/dev/null | grep -c "api" || true)

  if [ "$api_running" -eq 0 ]; then
    echo "[1/4] Starting containers (fresh build)..."
    docker compose up -d --build 2>&1 | grep -E "Created|Started|Building|Built" || true
    return 0
  fi

  # Containers exist. If the API isn't responsive, do the
  # heavy-handed down/up cycle (legacy recovery path).
  if ! docker compose exec -T api wget -qO- "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[1/4] API unresponsive — restarting containers..."
    docker compose down 2>/dev/null || true
    docker compose up -d --build 2>&1 | grep -E "Created|Started|Building|Built" || true
    return 0
  fi

  if [ "${SKIP_REBUILD:-0}" = "1" ]; then
    echo "[1/4] SKIP_REBUILD=1 — reusing existing container without rebuild"
    return 0
  fi

  # Default: rebuild + recreate so source edits ALWAYS land in
  # the running container. `up -d --build` rebuilds the image
  # (cache-friendly) and `--force-recreate` ensures the container
  # picks up the new image even when the prior tag is reused.
  echo "[1/4] Rebuilding containers to pick up source changes..."
  docker compose up -d --build --force-recreate 2>&1 \
    | grep -E "Created|Started|Building|Built|Recreated" \
    || true
}

# ── Wait for API health ────────────────────────────────────────────────────────

wait_for_health() {
  echo "[2/4] Waiting for API to be ready..."
  local elapsed=0
  while [ $elapsed -lt $MAX_WAIT ]; do
    if docker compose exec -T api wget -qO- "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
      echo "       API ready (${elapsed}s)"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf "       waiting... %ds / %ds\r" "$elapsed" "$MAX_WAIT"
  done
  echo ""
  echo "ERROR: API did not become healthy within ${MAX_WAIT}s"
  echo "--- API logs ---"
  local api_logs
  api_logs="$(docker compose logs --tail 50 api 2>/dev/null || true)"
  echo "$api_logs"

  if [ "$RESET_ATTEMPTED" -eq 0 ] && echo "$api_logs" | grep -qi "password authentication failed"; then
    echo "Detected PostgreSQL auth mismatch (likely stale volume). Resetting volumes and retrying once..."
    RESET_ATTEMPTED=1
    docker compose down -v 2>/dev/null || true
    docker compose up -d --build 2>&1 | grep -E "Created|Started|Building|Built" || true
    wait_for_health
    return 0
  fi

  exit 1
}

# ── Run tests ──────────────────────────────────────────────────────────────────

run_unit_tests() {
  echo "[3/5] Running unit tests..."
  echo "----------------------------------------"
  # Capture jest's real exit code BEFORE the trailing echo. The
  # previous version did `... 2>&1; echo ""` which made `echo`'s
  # 0 the function's return value, masking any jest failure.
  local rc=0
  docker compose exec -T api sh -c "npx jest --testPathPatterns=unit_tests --verbose --no-cache" 2>&1 || rc=$?
  echo ""
  return "$rc"
}

run_api_tests() {
  echo "[4/5] Running API integration tests..."
  echo "----------------------------------------"
  local rc=0
  docker compose exec -T \
    -e DATABASE_URL="$DB_URL" \
    api sh -c "npx jest --testPathPatterns=API_tests --verbose --no-cache --runInBand" 2>&1 || rc=$?
  echo ""
  return "$rc"
}

# Black-box E2E suite. Runs INSIDE the api container so it hits the
# real HTTP listener (no in-process AppModule bootstrap) and goes
# through every middleware, guard, interceptor, and exception filter
# exactly as production traffic would. E2E_BASE_URL is exported so the
# supertest helper resolves against the live listener rather than the
# default dev URL.
run_e2e_tests() {
  echo "[5/5] Running black-box E2E tests (HTTP against running API)..."
  echo "----------------------------------------"
  local rc=0
  docker compose exec -T \
    -e E2E_BASE_URL="$E2E_BASE_URL" \
    api sh -c "npx jest --testPathPatterns=e2e_tests --verbose --no-cache --runInBand" 2>&1 || rc=$?
  echo ""
  return "$rc"
}

# Coverage gate. Runs the full combined suite with --coverage, which
# makes Jest enforce `coverageThreshold` in jest.config.js. Failing
# coverage floors surface as a non-zero jest exit, which this function
# passes through just like the suites above.
run_coverage_gate() {
  echo "[coverage] Enforcing global coverage threshold..."
  echo "----------------------------------------"
  local rc=0
  docker compose exec -T \
    -e DATABASE_URL="$DB_URL" \
    -e E2E_BASE_URL="$E2E_BASE_URL" \
    api sh -c "npx jest --testPathPatterns='unit_tests|API_tests|e2e_tests' --runInBand --coverage --coverageReporters=text-summary" 2>&1 || rc=$?
  echo ""
  return "$rc"
}

# ── Main ───────────────────────────────────────────────────────────────────────

ensure_containers
wait_for_health

UNIT_EXIT=0
API_EXIT=0
E2E_EXIT=0
COV_EXIT=0

# `set -e` exempts the LHS of `||`, so the `|| VAR=$?` capture works
# without triggering an early exit. Each function returns the actual
# jest exit code.
run_unit_tests || UNIT_EXIT=$?
run_api_tests  || API_EXIT=$?
run_e2e_tests  || E2E_EXIT=$?

# Only attempt the coverage gate if the three test suites themselves
# passed. If any suite failed we already know the build is broken and
# re-running jest a fourth time just to watch it fail again wastes CI
# time. Skip with SKIP_COVERAGE=1 for local iteration.
if [ "${SKIP_COVERAGE:-0}" = "1" ]; then
  echo "[coverage] SKIP_COVERAGE=1 — skipping coverage gate"
elif [ "$UNIT_EXIT" -eq 0 ] && [ "$API_EXIT" -eq 0 ] && [ "$E2E_EXIT" -eq 0 ]; then
  run_coverage_gate || COV_EXIT=$?
else
  echo "[coverage] Skipped — earlier suite failed; fix that first"
fi

echo "========================================"
if [ "$UNIT_EXIT" -eq 0 ] && [ "$API_EXIT" -eq 0 ] && [ "$E2E_EXIT" -eq 0 ] && [ "$COV_EXIT" -eq 0 ]; then
  echo "  === ALL TESTS PASSED ==="
else
  # `if`/`then` form (not `[ ] && echo ...`) so a 0-state branch
  # doesn't propagate a non-zero RHS exit and trip `set -e`.
  if [ "$UNIT_EXIT" -ne 0 ]; then
    echo "  Unit tests:     FAILED (exit $UNIT_EXIT)"
  fi
  if [ "$API_EXIT" -ne 0 ]; then
    echo "  API tests:      FAILED (exit $API_EXIT)"
  fi
  if [ "$E2E_EXIT" -ne 0 ]; then
    echo "  E2E tests:      FAILED (exit $E2E_EXIT)"
  fi
  if [ "$COV_EXIT" -ne 0 ]; then
    echo "  Coverage gate:  FAILED (exit $COV_EXIT)"
  fi
  echo "  === SOME TESTS FAILED ==="
fi
echo "========================================"

# Saturating combine: any non-zero phase → exit 1. Avoids the
# pathological `exit $((U+A+E+C))` case where exit codes happen to
# sum to a multiple of 256 and POSIX wraps the wrapper exit to 0.
if [ "$UNIT_EXIT" -ne 0 ] || [ "$API_EXIT" -ne 0 ] || [ "$E2E_EXIT" -ne 0 ] || [ "$COV_EXIT" -ne 0 ]; then
  exit 1
fi
exit 0

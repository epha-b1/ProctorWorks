#!/bin/bash
set -e

echo "========================================"
echo "  ProctorWorks Test Suite"
echo "========================================"
echo ""

DB_URL="postgres://proctorworks:proctorworks@db:5432/proctorworks"
HEALTH_URL="http://localhost:3000/health"
MAX_WAIT=60
RESET_ATTEMPTED=0

# ── Ensure containers are running ──────────────────────────────────────────────

ensure_containers() {
  local api_running
  api_running=$(docker compose ps --status running 2>/dev/null | grep -c "api" || true)

  if [ "$api_running" -eq 0 ]; then
    echo "[1/4] Starting containers..."
    docker compose up -d --build 2>&1 | grep -E "Created|Started|Building|Built" || true
  else
    # Check if API is responsive; restart if not
    if ! docker compose exec -T api wget -qO- "$HEALTH_URL" >/dev/null 2>&1; then
      echo "[1/4] API unresponsive — restarting containers..."
      docker compose down 2>/dev/null || true
      docker compose up -d --build 2>&1 | grep -E "Created|Started|Building|Built" || true
    else
      echo "[1/4] Containers already running ✓"
    fi
  fi
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
  echo "[3/4] Running unit tests..."
  echo "----------------------------------------"
  docker compose exec -T api sh -c "npx jest --testPathPatterns=unit_tests --verbose --no-cache" 2>&1
  echo ""
}

run_api_tests() {
  echo "[4/4] Running API integration tests..."
  echo "----------------------------------------"
  docker compose exec -T \
    -e DATABASE_URL="$DB_URL" \
    api sh -c "npx jest --testPathPatterns=API_tests --verbose --no-cache --runInBand" 2>&1
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────────

ensure_containers
wait_for_health

UNIT_EXIT=0
API_EXIT=0

run_unit_tests || UNIT_EXIT=$?
run_api_tests  || API_EXIT=$?

echo "========================================"
if [ $UNIT_EXIT -eq 0 ] && [ $API_EXIT -eq 0 ]; then
  echo "  === ALL TESTS PASSED ==="
else
  [ $UNIT_EXIT -ne 0 ] && echo "  Unit tests:  FAILED (exit $UNIT_EXIT)"
  [ $API_EXIT  -ne 0 ] && echo "  API tests:   FAILED (exit $API_EXIT)"
  echo "  === SOME TESTS FAILED ==="
fi
echo "========================================"

exit $(( UNIT_EXIT + API_EXIT ))

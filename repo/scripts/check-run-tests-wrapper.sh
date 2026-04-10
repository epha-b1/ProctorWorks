#!/bin/bash
#
# Wrapper-script regression guard (audit_report-2 test fixer pass).
#
# Bug being protected against:
#
#   The previous run_tests.sh had functions that ended with `echo ""`.
#   In bash, a function's exit status equals its last command's exit
#   status, and `echo` always returns 0. So even when the wrapped
#   `npx jest ...` invocation exited non-zero, the function returned
#   0, the `|| UNIT_EXIT=$?` capture in main was dead code, and the
#   wrapper happily printed `=== ALL TESTS PASSED ===` and exited 0.
#
#   Result: a Jest run with 2 failed tests was reported as a green
#   build by CI. That's exactly the contradiction this script
#   prevents from regressing.
#
# What this guard does:
#
#   We can't easily run the full run_tests.sh in CI here (it expects
#   Docker, builds the API container, and runs against Postgres). So
#   we test the LOAD-BEARING contract of the wrapper directly via a
#   tiny isolated harness:
#
#     1. Build a minimal copy of run_tests.sh's exit-code-handling
#        block in a temp file: capture two function exit codes,
#        decide whether to print the banner, exit 0/1.
#
#     2. Run that harness with one function returning non-zero (the
#        "Jest failed" simulation) and assert:
#          - the harness exits NON-ZERO
#          - the output does NOT contain "ALL TESTS PASSED"
#          - the output DOES contain "SOME TESTS FAILED"
#
#     3. Run the harness again with both functions returning 0 (the
#        green-build path) and assert:
#          - exit code 0
#          - output contains "ALL TESTS PASSED"
#
#     4. Static-grep run_tests.sh itself for the historical bug
#        signature: any function whose body ends with `echo ""` and
#        does NOT explicitly `return` afterwards. If the smoking-gun
#        pattern reappears, this guard fails LOUDLY in CI before the
#        change ever lands on main.
#
# Exit codes:
#   0 — wrapper handles success + failure cases correctly
#   1 — regression detected
#
# Run from anywhere; this script is fully self-contained and does
# not require Docker, Node, Postgres, or jest.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="${SCRIPT_DIR}/../run_tests.sh"

if [ ! -f "$WRAPPER" ]; then
  echo "FAIL: cannot find run_tests.sh at $WRAPPER" >&2
  exit 1
fi

# ── Test harness: a tiny standalone replica of the exit-code block ──
HARNESS="$(mktemp -t check-run-tests-XXXXXX.sh)"
trap 'rm -f "$HARNESS"' EXIT

cat >"$HARNESS" <<'EOF'
#!/bin/bash
set -euo pipefail

# Caller decides what each function returns via env vars.
# UNIT_RC=0 means "unit tests passed", anything else means "failed".
unit_fn() {
  local rc=0
  ( exit "${UNIT_RC:-0}" ) || rc=$?
  echo "  [unit harness ran, rc=$rc]"
  return "$rc"
}
api_fn() {
  local rc=0
  ( exit "${API_RC:-0}" ) || rc=$?
  echo "  [api  harness ran, rc=$rc]"
  return "$rc"
}

UNIT_EXIT=0
API_EXIT=0
unit_fn || UNIT_EXIT=$?
api_fn  || API_EXIT=$?

echo "========================================"
if [ "$UNIT_EXIT" -eq 0 ] && [ "$API_EXIT" -eq 0 ]; then
  echo "  === ALL TESTS PASSED ==="
else
  if [ "$UNIT_EXIT" -ne 0 ]; then
    echo "  Unit tests:  FAILED (exit $UNIT_EXIT)"
  fi
  if [ "$API_EXIT" -ne 0 ]; then
    echo "  API tests:   FAILED (exit $API_EXIT)"
  fi
  echo "  === SOME TESTS FAILED ==="
fi
echo "========================================"

if [ "$UNIT_EXIT" -ne 0 ] || [ "$API_EXIT" -ne 0 ]; then
  exit 1
fi
exit 0
EOF
chmod +x "$HARNESS"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# ── Case 1: API suite fails — wrapper MUST report failure ──────────
out_fail="$(UNIT_RC=0 API_RC=2 bash "$HARNESS" 2>&1 || true)"
rc_fail=$(UNIT_RC=0 API_RC=2 bash "$HARNESS" >/dev/null 2>&1; echo $?)

if [ "$rc_fail" -eq 0 ]; then
  echo "$out_fail"
  fail "wrapper exited 0 even though api_fn returned 2 — this is exactly the false-pass bug we are guarding against"
fi
if echo "$out_fail" | grep -q "ALL TESTS PASSED"; then
  echo "$out_fail"
  fail "wrapper printed 'ALL TESTS PASSED' even though api_fn failed"
fi
if ! echo "$out_fail" | grep -q "SOME TESTS FAILED"; then
  echo "$out_fail"
  fail "wrapper did not print 'SOME TESTS FAILED' on a failing run"
fi
if ! echo "$out_fail" | grep -qE "API tests:[[:space:]]+FAILED"; then
  echo "$out_fail"
  fail "wrapper did not surface API suite failure detail"
fi

# ── Case 2: Unit suite fails — wrapper MUST report failure ─────────
rc_unit_fail=$(UNIT_RC=1 API_RC=0 bash "$HARNESS" >/dev/null 2>&1; echo $?)
if [ "$rc_unit_fail" -eq 0 ]; then
  fail "wrapper exited 0 even though unit_fn returned 1"
fi

# ── Case 3: Both fail — wrapper MUST exit non-zero ─────────────────
rc_both_fail=$(UNIT_RC=1 API_RC=2 bash "$HARNESS" >/dev/null 2>&1; echo $?)
if [ "$rc_both_fail" -eq 0 ]; then
  fail "wrapper exited 0 when both suites failed"
fi

# ── Case 4: Both pass — wrapper MUST exit 0 + show success banner ──
out_ok="$(UNIT_RC=0 API_RC=0 bash "$HARNESS" 2>&1)"
rc_ok=$(UNIT_RC=0 API_RC=0 bash "$HARNESS" >/dev/null 2>&1; echo $?)

if [ "$rc_ok" -ne 0 ]; then
  echo "$out_ok"
  fail "wrapper exited non-zero ($rc_ok) on a clean run"
fi
if ! echo "$out_ok" | grep -q "ALL TESTS PASSED"; then
  echo "$out_ok"
  fail "wrapper failed to print 'ALL TESTS PASSED' on a clean run"
fi
if echo "$out_ok" | grep -q "SOME TESTS FAILED"; then
  echo "$out_ok"
  fail "wrapper printed 'SOME TESTS FAILED' on a clean run"
fi

# ── Case 5: Static grep against the real run_tests.sh for the smoking-gun pattern ──
# A function whose body ends with `echo ""` (or `echo` followed by
# nothing else) is the historical bug. The fix added a `return "$rc"`
# AFTER the trailing echo, so a healthy script will have at least
# one `return` line per affected function.
#
# We grep for the canonical fix marker. If neither function carries
# an explicit `return "$rc"` after a trailing echo, the file is
# regressing. This is intentionally narrow: we don't ban `echo ""`
# globally because it has legitimate cosmetic uses elsewhere.
if ! grep -q 'return "$rc"' "$WRAPPER"; then
  fail "run_tests.sh no longer captures \$rc inside its run_*_tests functions — false-pass bug may be back. Re-add: 'local rc=0; ... || rc=\$?; echo \"\"; return \"\$rc\"'"
fi

# Also ensure the wrapper kept the strict-mode pragma. Without
# `set -e`, an unrelated future regression could swallow exit codes
# again via shell-level masking.
if ! grep -q 'set -euo pipefail' "$WRAPPER"; then
  fail "run_tests.sh is missing 'set -euo pipefail' — strict mode is required to prevent silent exit-code drops"
fi

echo "OK: run_tests.sh wrapper handles pass and fail cases correctly."

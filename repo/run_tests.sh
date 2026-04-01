#!/bin/bash
set -e

echo "=== ProctorWorks Test Suite ==="
echo ""

if ! docker compose ps --status running 2>/dev/null | grep -q "api"; then
  echo "--- Containers not running, starting... ---"
  docker compose up -d --build
  echo "--- Waiting for app to be ready... ---"
  for i in $(seq 1 30); do
    if docker compose exec -T api wget -qO- http://localhost:3000/health >/dev/null 2>&1; then
      echo "--- App is ready ---"
      break
    fi
    echo "  waiting... ($i/30)"
    sleep 3
  done
fi

echo "--- Running unit tests ---"
docker compose exec -T api sh -c "npx jest --testPathPatterns=unit_tests --verbose --no-cache"

echo ""
echo "--- Running API tests ---"
docker compose exec -T -e DATABASE_URL=postgres://proctorworks:proctorworks@db:5432/proctorworks api sh -c "npx jest --testPathPatterns=API_tests --verbose --no-cache --runInBand"

EXIT=$?

echo ""
if [ $EXIT -eq 0 ]; then
  echo "=== ALL TESTS PASSED ==="
else
  echo "=== TESTS FAILED ==="
fi
exit $EXIT

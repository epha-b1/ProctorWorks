# ProctorWorks

Offline operations platform for managing a catalog-driven practice product business and reservable study spaces.

## Stack

NestJS + TypeORM + PostgreSQL. Runs on a single Docker host with no external connectivity.

## Quick Start (Docker)

```bash
docker compose up --build
```

- **API**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/api/docs
- **Health check**: http://localhost:3000/health

## Quick Start (Local / No Docker)

Requires Node 20+ and a running PostgreSQL instance.

```bash
# 1. Set environment
export DATABASE_URL=postgres://proctorworks:proctorworks@127.0.0.1:5433/proctorworks
export JWT_SECRET=dev-jwt-secret-min-32-chars-long-x
export ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff

# 2. Install and build
npm install --legacy-peer-deps
npm run build

# 3. Start (ensure DB is running with matching credentials)
npm start

# 4. Run tests
npm run test:unit -- --runInBand
npm run test:api -- --runInBand
```

## Default Credentials

| Username | Password     | Role            |
|----------|-------------|-----------------|
| admin    | Admin1234!  | platform_admin  |
| store_admin | Admin1234! | store_admin  |
| reviewer | Admin1234!  | content_reviewer |
| auditor  | Admin1234!  | auditor         |

## Run Tests

```bash
# Docker (recommended — fully self-contained, runs every suite + coverage gate)
./run_tests.sh

# Local
npm run test:unit -- --runInBand
npm run test:api  -- --runInBand
npm run test:e2e  -- --runInBand   # requires the API to be running at E2E_BASE_URL
npm run test:cov  -- --runInBand   # enforces the coverage gate
```

### Suites and what they guard

| Folder        | Type                           | Bootstraps Nest in-process? | Hits HTTP?                | Primary contract                              |
|---------------|--------------------------------|-----------------------------|----------------------------|-----------------------------------------------|
| `unit_tests/` | Unit (services, pipes, guards) | n/a                         | No                         | Pure logic, branch coverage                    |
| `API_tests/`  | API integration (supertest)    | Yes (per-suite `AppModule`) | In-process via supertest   | Controller ↔ service ↔ DB contract, strict status codes, payload invariants |
| `e2e_tests/`  | Black-box E2E (supertest → URL) | **No** — boots against running container | Yes, real network        | Full request pipeline: compression → guard → interceptor → filter → DB, including audit-log side effects |

The E2E suite deliberately does not import `AppModule`. It hits
`E2E_BASE_URL` (default `http://localhost:3000`) over real HTTP so the
container boundary is exercised exactly as production traffic would be.
`run_tests.sh` exports `E2E_BASE_URL` into the `api` container and runs
jest there, so the URL resolves to the container's own listener and no
host port forwarding is required.

### Coverage gate

`jest.config.js` enforces a global `coverageThreshold`:

- statements ≥ 80%, lines ≥ 80%, functions ≥ 80%, branches ≥ 70%

The gate runs as the final step in `run_tests.sh` (after unit + API +
E2E) and as `npm run test:cov` locally. A drop below any floor fails
the build with a non-zero jest exit. Entity files, DTOs, `main.ts`,
module wiring, and `src/database/**` are excluded from coverage since
they are declarative glue with no meaningful branches.

Skip with `SKIP_COVERAGE=1 ./run_tests.sh` during local iteration when
the three test suites are green and you just want a fast rerun.

### Preflight (API tests only)

`npm run test:api` runs a fast Postgres handshake preflight
(`scripts/check-test-db.js`) before invoking Jest. If the test DB is
unreachable the preflight exits 1 with a clear diagnostic and the
suite never starts. Override the target DB with
`DATABASE_URL=postgres://user:pass@host:port/db npm run test:api`.
On hosts where docker port-forwarding is flaky, start Postgres in
host-network mode (see `scripts/check-test-db.js` for the exact
command) and point `DATABASE_URL` at it.

## Services

| Service | Port |
|---------|------|
| API     | 3000 |
| PostgreSQL | 5433 (host) / 5432 (internal) |

## Environment Variables

See `.env.example` for all configurable values. Key variables:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (min 32 chars)
- `ENCRYPTION_KEY` — AES-256 key for field-level encryption (64 hex chars)
- `LOW_STOCK_THRESHOLD` — Units below which low-stock alerts fire (default: 10)
- `STALENESS_THRESHOLD_HOURS` — Hours before data freshness alert (default: 24)

## Database Indexes

All foreign keys indexed. Additional performance indexes on:
- `reservations.hold_until`, `reservations.status`
- `orders.idempotency_key` (NON-UNIQUE — see "Order idempotency" below),
  `inventory_adjustments.idempotency_key`
- `coupons.code`, `promotions.priority`
- `audit_logs.created_at`, `audit_logs.actor_id`, `audit_logs.action`
- `questions.type`, `questions.status`

## Order idempotency

`POST /orders` is idempotent per `(operation_type, actor_id, store_id, key)`.
Two callers in different stores can legitimately reuse the same opaque
`idempotencyKey` and each receive their own fresh order — the previous
schema enforced a global UNIQUE on `orders.idempotency_key` which made
that scenario fail with a Postgres unique-violation. The fix is split
across two migrations:

- `1711900000003-ScopeIdempotencyKeys` installs the composite UNIQUE
  index `(operation_type, actor_id, COALESCE(store_id, sentinel), key)`
  on the `idempotency_keys` table. This is the actual deduplication
  contract. NULL store ids are normalized to a sentinel UUID so
  cross-store / platform-admin operations still collide deterministically.
- `1711900000004-DropOrdersIdempotencyKeyUnique` (HIGH-1) drops the
  legacy global UNIQUE constraint on `orders.idempotency_key` and
  replaces it with a plain BTREE index. The migration is idempotent
  and additionally sweeps any environment that ended up with the
  constraint under a TypeORM-auto-generated name.

The OrdersService dedup path performs the lookup against
`idempotency_keys` and additionally verifies the resolved order's
`store_id` and `user_id` match the caller's scope before returning, so
even a stray legacy row cannot leak across tenants.

## Audit logs

Audit logs are append-only. Two BEFORE triggers (`trg_audit_logs_no_delete`
and `trg_audit_logs_no_update`) installed by `InitialSchema1711900000000`
raise an exception on any DELETE or UPDATE attempt at the database
level, so a compromised application user cannot tamper with the trail
even with table-level grants.

### Coverage

`AuditService.log(...)` is invoked from controllers on every admin
write surface. Action names are stable identifiers used for filtering
in `/audit-logs?action=...`:

| Module        | Action names |
|---------------|--------------|
| Orders        | `create_order`, `confirm_order`, `fulfill_order`, `cancel_order` |
| Reservations  | `create_reservation_hold`, `confirm_reservation`, `cancel_reservation` |
| Questions     | `create_question`, `update_question`, `delete_question`, `approve_question`, `reject_question`, `bulk_import_questions`, `add_question_explanation` |
| Assessments   | `generate_paper`, `start_attempt`, `submit_attempt`, `redo_attempt` |
| Promotions    | `create_promotion`, `update_promotion`, `delete_promotion`, `create_coupon`, `claim_coupon`, `distribute_coupon`, `expire_coupon` |
| Rooms         | `create_room`, `update_room`, `delete_room`, `create_zone`, `create_seat`, `update_seat`, `delete_seat`, `publish_seat_map` |
| Products      | `create_product`, `publish_product`, `approve_product`, etc. |

Every entry includes `actor_id`, `action`, `resource_type`, `resource_id`
(when applicable), `detail`, `trace_id`, and `created_at`. The trace id
is propagated automatically by the `TraceIdInterceptor` so log entries
can be correlated end-to-end with request logs.

### Retention strategy (7 years)

Audit retention is **7 years** as documented in the `audit_logs` table
comment installed by `InitialSchema1711900000000`. The DB-level
immutability triggers prevent ad-hoc deletion, so retention enforcement
must be deliberate and operator-driven rather than implicit. The
recommended workflow on this single-host offline deployment is:

1. **Cold archive once per quarter.**
   Stream the immutable rows out via `GET /audit-logs/export` (CSV,
   masks sensitive fields via `maskSensitiveFields`) into a tamper-
   evident archive (encrypted volume, signed bundle, write-once
   storage). This is the canonical long-term retention surface and
   does not require any DB mutation.

2. **Periodic integrity check.**
   Hash the export and store the digest separately. Because the
   underlying rows are immutable, recomputing the digest from a fresh
   export must always produce the same value until pruning happens.

3. **Pruning beyond 7 years (operator action).**
   Pruning is an explicit operator action, never automatic. The DB
   triggers must be temporarily lifted by a privileged migration that:
   - drops `trg_audit_logs_no_delete`
   - executes a single `DELETE` bounded by
     `created_at < NOW() - INTERVAL '7 years'`
   - re-installs the trigger
   The migration must run inside a single transaction so the trigger
   is never absent for more than the lifetime of the prune. Sample
   skeleton:

   ```sql
   BEGIN;
   DROP TRIGGER trg_audit_logs_no_delete ON audit_logs;
   DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '7 years';
   CREATE TRIGGER trg_audit_logs_no_delete
     BEFORE DELETE ON audit_logs
     FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
   COMMIT;
   ```

   The runbook must require the cold archive from step 1 to exist
   before pruning is approved, so any deleted rows remain recoverable
   from the archive for the full retention window.

This split — immutability enforced in code, retention enforced by an
auditable runbook — preserves the tamper-evidence guarantee for the
99.99% case (no automatic mutation) while still giving operators a
documented escape hatch for the edge case where the table genuinely
needs to be pruned.

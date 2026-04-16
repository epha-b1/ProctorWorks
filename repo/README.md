# ProctorWorks

**Project Type: backend**

Offline operations platform for managing a catalog-driven practice product business and reservable study spaces. A NestJS + TypeORM + PostgreSQL API packaged to run on a single Docker host with no external connectivity.

## Stack

NestJS + TypeORM + PostgreSQL. Runs on a single Docker host with no external connectivity. Every operator flow — startup, tests, and verification — is fully Docker-contained and requires no host Node, host Postgres, or host `npm install`.

## Quick Start (Docker — the only supported path)

Both Compose CLI variants are accepted:

```bash
# Compose v2 (plugin)
docker compose up --build

# Compose v1 / symlinked binaries
docker-compose up --build
```

Either command stands up the full stack: the `api` service (NestJS) and the `db` service (Postgres 16) — plus runs migrations and seed data on first boot.

- **API**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/api/docs
- **Health check**: http://localhost:3000/health
- **Postgres**: host-port `5433` (internal `5432`)

Stop and clean up:

```bash
docker compose down -v   # or: docker-compose down -v
```

## Verification

After `docker compose up --build` (or `docker-compose up --build`) reports both services as healthy, run these from the host to prove the deployed surface end-to-end. No host dependencies beyond `curl`.

### 1. Liveness — `GET /health`

```bash
curl -sS http://localhost:3000/health
```

Expected response (shape; `timestamp` is a current ISO-8601 string):

```json
{ "status": "ok", "database": "connected", "timestamp": "2026-..." }
```

Success criteria: HTTP `200`, `status === "ok"`, `database === "connected"`.

### 2. Authentication — `POST /auth/login`

```bash
curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin1234!"}'
```

Expected response shape:

```json
{ "accessToken": "eyJ...<JWT>...", "user": { "id": "...", "username": "admin", "role": "platform_admin" } }
```

Success criteria: HTTP `200`, `accessToken` is a non-empty JWT string, `user.role === "platform_admin"`.

### 3. Protected endpoint with bearer token — `GET /auth/me`

Reuse the token from step 2:

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin1234!"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

curl -sS http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected response shape:

```json
{ "id": "...", "username": "admin", "role": "platform_admin", "storeId": null }
```

Success criteria: HTTP `200`, payload echoes the authenticated user (`username === "admin"`). A missing or tampered token yields `401`.

## Demo Credentials

The seed migration installs one user per role so operators can exercise every role matrix immediately after startup:

| Username     | Password    | Role               |
|--------------|-------------|--------------------|
| `admin`      | `Admin1234!`| `platform_admin`   |
| `store_admin`| `Admin1234!`| `store_admin`      |
| `reviewer`   | `Admin1234!`| `content_reviewer` |
| `auditor`    | `Admin1234!`| `auditor`          |

These users are created by `1711900000001-SeedDemoData.ts` and are re-applied on every fresh volume. Rotate passwords before any non-dev deployment.

## Run Tests

The entire test pipeline runs inside Docker via the project's wrapper. No host Node, host Postgres, or host `npm install` is required.

```bash
./run_tests.sh
```

`run_tests.sh` is the only supported test entrypoint. It:

1. Ensures the `api` and `db` containers are up (`docker compose up -d --build --force-recreate`).
2. Waits for `/health` to return `{"status":"ok"}`.
3. Inside the `api` container, runs unit tests (`[3/5]`), API integration tests (`[4/5]`), and the black-box E2E tests (`[5/5]`).
4. Runs the coverage gate once all three suites are green.
5. Exits non-zero if any suite OR the coverage gate fails.

Each suite is invoked via `docker compose exec -T api sh -c "npx jest …"` — the jest runner executes inside the container, so there is no host toolchain dependency. `E2E_BASE_URL` defaults to `http://localhost:3000` (the container's own listener) and is injected at exec time.

### Suites and what they guard

| Folder        | Type                                         | Bootstraps Nest in-process? | Hits HTTP?                | Primary contract                              |
|---------------|----------------------------------------------|-----------------------------|----------------------------|-----------------------------------------------|
| `unit_tests/` | Unit (services, pipes, guards, interceptors) | n/a                         | No                         | Pure logic, branch coverage                    |
| `API_tests/`  | API integration (supertest)                  | Yes (per-suite `AppModule`) | In-process via supertest   | Controller ↔ service ↔ DB contract, strict status codes, payload invariants |
| `e2e_tests/`  | Black-box E2E (supertest → URL)              | **No** — hits the running container | Yes, real network     | Full request pipeline: compression → guard → interceptor → filter → DB, including audit-log side effects |

The E2E suite deliberately does not import `AppModule`. It hits
`E2E_BASE_URL` (default `http://localhost:3000`) over real HTTP so the
container boundary is exercised exactly as production traffic would be.
`run_tests.sh` exports `E2E_BASE_URL` into the `api` container so the
URL resolves to the container's own listener.

### Coverage gate

`jest.config.js` enforces a global `coverageThreshold` (kept in sync with this section):

| Metric     | Floor |
|------------|-------|
| Statements | **93%** |
| Branches   | **83%** |
| Functions  | **96%** |
| Lines      | **94%** |

The gate runs as the final step in `run_tests.sh` (after unit + API +
E2E). A drop below any floor fails the build with a non-zero jest
exit. Entity files, DTOs, `main.ts`, module wiring, `src/database/**`,
and `src/config/**` are excluded from the denominator because they are
declarative glue with no meaningful branches.

Skip the coverage phase with `SKIP_COVERAGE=1 ./run_tests.sh` during
local iteration when the three suites are green and you just want a
fast rerun.

### Skipping the rebuild for fast iteration

`run_tests.sh` rebuilds the `api` image on every run so source edits
always land in the tested container. Set `SKIP_REBUILD=1` when you
know the image is already fresh (e.g., in CI after a build step that
already produced the image) and want to avoid the rebuild overhead:

```bash
SKIP_REBUILD=1 ./run_tests.sh
```

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

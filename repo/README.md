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
# Docker (recommended — fully self-contained)
./run_tests.sh

# Local
npm run test:unit -- --runInBand
npm run test:api -- --runInBand
```

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
- `orders.idempotency_key`, `inventory_adjustments.idempotency_key`
- `coupons.code`, `promotions.priority`
- `audit_logs.created_at`, `audit_logs.actor_id`, `audit_logs.action`
- `questions.type`, `questions.status`

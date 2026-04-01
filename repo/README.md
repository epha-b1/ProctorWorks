# ProctorWorks

Offline operations platform for managing a catalog-driven practice product business and reservable study spaces.

## Stack

NestJS + TypeORM + PostgreSQL. Runs on a single Docker host with no external connectivity.

## Quick Start

```bash
docker compose up --build
```

- **API**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/api/docs
- **Health check**: http://localhost:3000/health

## Default Credentials

| Username | Password     | Role            |
|----------|-------------|-----------------|
| admin    | Admin1234!  | platform_admin  |

## Run Tests

```bash
./run_tests.sh
```

Runs unit tests and API integration tests inside the Docker container.

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

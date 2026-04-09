# ProctorWorks — Design Document

## 1. Overview

ProctorWorks is an offline-first backend API platform. No UI. Pure REST API built with NestJS + TypeORM + PostgreSQL. Runs on a single Docker host with no external connectivity.

---

## 2. Architecture

```
HTTP Client (Postman / frontend)
  │
  ▼
NestJS HTTP Server (port 3000)
  ├── Global Exception Filter     → structured JSON errors
  ├── Trace ID Interceptor        → X-Trace-Id on every request
  ├── JWT Auth Guard              → validates Bearer token
  ├── Roles Guard                 → RBAC enforcement
  ├── Validation Pipe             → class-validator on all DTOs
  └── Domain Controllers/Services
        │
        ▼
   TypeORM Repository layer
        │
        ▼
   PostgreSQL (port 5432)
```

---

## 3. Technology Stack

| Layer | Choice |
|---|---|
| HTTP framework | NestJS |
| ORM | TypeORM |
| Database | PostgreSQL 16 |
| Auth | JWT (local, no external IdP) |
| Password hashing | bcrypt (rounds=12) |
| Field encryption | AES-256-GCM |
| Validation | class-validator + class-transformer |
| Scheduling | @nestjs/schedule |
| API docs | @nestjs/swagger (Swagger UI at /api/docs) |
| Logging | Nest Logger with structured request/error interceptors |
| Container | Docker + docker-compose |

---

## 4. Module Responsibilities

| Module | Responsibility |
|---|---|
| `auth` | Login, JWT, password hashing, account management |
| `rooms` | Study rooms, zones, seats, seat map versioning |
| `reservations` | Seat holds, confirm, cancel, expiry job |
| `products` | SPU, SKU, categories, brands, spec attributes, pricing |
| `inventory` | InventoryLots, stock adjustments, low-stock alerts |
| `orders` | Order lifecycle, state machine, idempotency |
| `promotions` | Coupons, discounts, campaigns, conflict resolution |
| `questions` | Question bank, versioned explanations, bulk ops |
| `assessments` | Papers, attempts, grading, history, redo |
| `quality` | Data quality rules, scores, freshness monitoring |
| `notifications` | Persisted admin notifications |
| `audit` | Append-only audit log, 7-year retention |
| `common` | Guards, interceptors, filters, decorators, pipes |

---

## 5. Data Model

### Auth

```
users
  id uuid PK
  username text UNIQUE NOT NULL
  password_hash text NOT NULL          -- bcrypt
  role enum NOT NULL                   -- platform_admin | store_admin | content_reviewer | auditor
  store_id uuid FK stores (nullable)   -- only for store_admin
  status enum DEFAULT active           -- active | suspended | locked
  failed_login_count int DEFAULT 0
  locked_until timestamptz
  created_at timestamptz
  updated_at timestamptz

stores
  id uuid PK
  name text UNIQUE NOT NULL
  created_at timestamptz
```

### Rooms and Seats

```
study_rooms
  id uuid PK
  name text NOT NULL
  created_at timestamptz

zones
  id uuid PK
  room_id uuid FK study_rooms
  name text NOT NULL

seats
  id uuid PK
  zone_id uuid FK zones
  label text NOT NULL
  power_outlet bool DEFAULT false
  quiet_zone bool DEFAULT false
  ada_accessible bool DEFAULT false
  status enum DEFAULT available        -- available | disabled | maintenance

seat_map_versions
  id uuid PK
  room_id uuid FK study_rooms
  version_number int NOT NULL
  created_by uuid FK users
  change_note text NOT NULL            -- 20-500 chars
  snapshot jsonb NOT NULL              -- full seat map at publish time
  created_at timestamptz NOT NULL
  UNIQUE (room_id, version_number)

reservations
  id uuid PK
  seat_id uuid FK seats
  user_id uuid FK users
  status enum DEFAULT hold             -- hold | confirmed | cancelled | expired
  hold_until timestamptz NOT NULL
  confirmed_at timestamptz
  cancelled_at timestamptz
  created_at timestamptz
```

### Commerce

```
categories
  id uuid PK
  name text UNIQUE NOT NULL
  parent_id uuid FK categories (nullable)

brands
  id uuid PK
  name text UNIQUE NOT NULL

products (SPU)
  id uuid PK
  store_id uuid FK stores
  name text NOT NULL
  category_id uuid FK categories
  brand_id uuid FK brands
  status enum DEFAULT draft            -- draft | pending_review | published | unpublished
  created_at timestamptz

skus
  id uuid PK
  product_id uuid FK products
  sku_code text UNIQUE NOT NULL
  price_cents int NOT NULL
  member_price_cents int
  attributes jsonb                     -- spec attributes
  created_at timestamptz

sku_price_tiers
  id uuid PK
  sku_id uuid FK skus
  tier_name text NOT NULL
  price_cents int NOT NULL

inventory_lots
  id uuid PK
  sku_id uuid FK skus
  batch_code text NOT NULL
  expiration_date date
  quantity int NOT NULL DEFAULT 0
  created_at timestamptz

inventory_adjustments
  id uuid PK
  lot_id uuid FK inventory_lots
  delta int NOT NULL                   -- positive = add, negative = remove
  reason_code text NOT NULL
  idempotency_key text UNIQUE NOT NULL
  adjusted_by uuid FK users
  created_at timestamptz

orders
  id uuid PK
  store_id uuid FK stores
  user_id uuid FK users
  status enum DEFAULT pending          -- pending | confirmed | fulfilled | cancelled
  idempotency_key text UNIQUE NOT NULL
  total_cents int NOT NULL
  discount_cents int DEFAULT 0
  coupon_id uuid FK coupons (nullable)
  promotion_id uuid FK promotions (nullable)
  created_at timestamptz
  updated_at timestamptz

order_items
  id uuid PK
  order_id uuid FK orders
  sku_id uuid FK skus
  quantity int NOT NULL
  unit_price_cents int NOT NULL
```

### Promotions

```
promotions
  id uuid PK
  store_id uuid FK stores
  name text NOT NULL
  type enum                            -- threshold | percentage | first_order
  priority int NOT NULL                -- 1-1000
  discount_type enum                   -- fixed_cents | percentage
  discount_value int NOT NULL
  min_order_cents int                  -- for threshold type
  starts_at timestamptz
  ends_at timestamptz
  redemption_cap int
  redemption_count int DEFAULT 0
  active bool DEFAULT true

coupons
  id uuid PK
  store_id uuid FK stores
  code text UNIQUE NOT NULL
  promotion_id uuid FK promotions
  remaining_quantity int
  starts_at timestamptz
  ends_at timestamptz
  status enum DEFAULT active           -- active | expired | exhausted

coupon_claims
  id uuid PK
  coupon_id uuid FK coupons
  user_id uuid FK users
  claimed_at timestamptz
  redeemed_at timestamptz
  order_id uuid FK orders (nullable)
```

### Questions and Assessments

```
questions
  id uuid PK
  store_id uuid FK stores
  type enum NOT NULL                   -- objective | subjective
  body text NOT NULL
  status enum DEFAULT draft            -- draft | pending_review | approved | rejected
  created_by uuid FK users
  created_at timestamptz

question_options
  id uuid PK
  question_id uuid FK questions
  body text NOT NULL
  is_correct bool NOT NULL

question_explanations
  id uuid PK
  question_id uuid FK questions
  version_number int NOT NULL
  body text NOT NULL
  created_by uuid FK users
  created_at timestamptz
  UNIQUE (question_id, version_number)

papers
  id uuid PK
  store_id uuid FK stores
  name text NOT NULL
  generation_rule jsonb NOT NULL       -- random count or rule-based filters
  created_by uuid FK users
  created_at timestamptz

paper_questions
  paper_id uuid FK papers
  question_id uuid FK questions
  position int NOT NULL
  PRIMARY KEY (paper_id, question_id)

attempts
  id uuid PK
  paper_id uuid FK papers
  user_id uuid FK users
  parent_attempt_id uuid FK attempts (nullable)  -- for redo
  status enum DEFAULT in_progress      -- in_progress | submitted | graded
  score decimal
  graded_at timestamptz
  started_at timestamptz
  submitted_at timestamptz

attempt_answers
  id uuid PK
  attempt_id uuid FK attempts
  question_id uuid FK questions
  selected_option_id uuid FK question_options (nullable)
  text_answer text                     -- for subjective
  is_correct bool                      -- set on grading
```

### Quality and Audit

```
data_quality_rules
  id uuid PK
  entity_type text NOT NULL            -- products | orders | questions | users | inventory
  rule_type enum                       -- completeness | range | uniqueness
  config jsonb NOT NULL
  active bool DEFAULT true

data_quality_scores
  id uuid PK
  entity_type text NOT NULL
  score decimal NOT NULL               -- 0-100
  computed_at timestamptz NOT NULL

notifications
  id uuid PK
  user_id uuid FK users
  type text NOT NULL
  message text NOT NULL
  read bool DEFAULT false
  created_at timestamptz

audit_logs
  id uuid PK
  actor_id uuid FK users
  action text NOT NULL
  resource_type text
  resource_id uuid
  detail jsonb
  trace_id text
  created_at timestamptz NOT NULL
  -- NO UPDATE, NO DELETE for app DB role

idempotency_keys
  key text PK
  operation_type text NOT NULL
  response_body jsonb NOT NULL
  created_at timestamptz NOT NULL
```

---

## 6. Key Flows

### Seat Reservation Hold

```
1. POST /reservations {seat_id, user_id}
2. Check seat.status != maintenance → else 400
3. Check no active hold on seat (holdUntil > now) → else 409
4. INSERT reservations (status=hold, holdUntil=now+15min)
5. Return 201 + reservation

Background job (every 60s):
UPDATE reservations SET status=expired WHERE status=hold AND holdUntil < now()
UPDATE seats SET status=available WHERE id IN (expired reservations)
```

### Order with Promotion

```
1. POST /orders {idempotency_key, items, coupon_code?}
2. Check idempotency_key not in idempotency_keys → else return stored response
3. Calculate subtotal from items
4. Find applicable automatic promotions (active, within time window, not capped)
5. If coupon_code provided: validate coupon (active, not expired, not exhausted)
6. Resolve conflicts: sort by priority desc, tie-break by best customer value
7. Apply at most one coupon + one automatic promotion
8. INSERT order + order_items
9. Store idempotency_key + response
10. Return 201
```

### Promotion Conflict Resolution

```
1. Collect all eligible promotions (automatic + coupon's linked promotion)
2. Sort by priority DESC
3. If tie on priority: calculate discount amount for each, pick highest
4. If still tied: pick lower UUID as deterministic tie-breaker
5. Apply selected promotion(s) — max one coupon + one automatic
```

---

## 7. Security Design

- Passwords: bcrypt with 12 rounds
- JWT: HS256, secret from env, 8-hour expiry, carries `jti` claim linked to a server-side `sessions` row
- Session lifecycle: a `sessions` row is created on login (active=true). Logout flips `is_active=false` and the JWT strategy rejects subsequent requests carrying the same `jti` with 401. Suspending or locking a user via `PATCH /users/:id` invalidates every active session for that user.
- Field encryption: AES-256-GCM for `orders.internal_notes`, `users.notes`
- Audit log: INSERT-only for app DB role, no UPDATE/DELETE
- Row-level access: store_admin queries always filtered by `store_id`. Question bank operations (create/read/update/delete/wrong-answer-stats/import/export) derive `store_id` from the JWT for store_admin and reject cross-store access with 404.
- Role matrix on Assessments: `auditor` is read-only — `GET /papers`, `GET /papers/:id`, `GET /attempts/history` are open to platform_admin / store_admin / content_reviewer / auditor; `POST /papers`, `POST /attempts`, `POST /attempts/:id/submit`, `POST /attempts/:id/redo` exclude auditor and return 403.
- Quality rules: rule config columns are validated against a per-entity-type allowlist before persistence and re-validated at evaluation time; raw SQL identifier interpolation is not accepted.
- Promotion redemption: `redemption_count` is incremented atomically inside the redeem transaction with a guard `redemption_count < redemption_cap`; cap-at-limit redemptions return 400. Distribution flow re-runs the same status/window/quantity checks as direct claim and decrements `remaining_quantity` by the recipient count atomically.
- Trace IDs: UUID generated per request by `TraceIdInterceptor`, attached to all log lines and the response header `X-Trace-Id`. Audit log entries pick up the same trace ID via the `@TraceId()` parameter decorator passed to `auditService.log(...)`.
- Sensitive fields masked in audit export: password_hash, encrypted fields shown as `[REDACTED]`

---

## 8. Background Jobs

| Job | Interval | Description |
|---|---|---|
| Release expired holds | 60s | Set expired reservations to expired status |
| Low-stock check | 10 min | Create notifications for SKUs below threshold |
| Expiration date check | Daily at 00:00 | Create notifications for lots expiring within 7 days |
| Data quality score | 1 hour | Recompute quality scores per entity type |
| Freshness check | 1 hour | Create notifications for stale datasets |
| Coupon expiry | 1 hour | Set expired coupons to expired status |

---

## 9. Error Handling

All errors return:
```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "human readable message",
  "traceId": "uuid"
}
```

Standard codes: VALIDATION_ERROR (400), UNAUTHORIZED (401), FORBIDDEN (403), NOT_FOUND (404), CONFLICT (409), IDEMPOTENCY_CONFLICT (409), INTERNAL_ERROR (500)

---

## 10. Docker Setup

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://proctorworks:proctorworks@db:5432/proctorworks
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: proctorworks
      POSTGRES_PASSWORD: proctorworks
      POSTGRES_DB: proctorworks
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U proctorworks"]
      interval: 5s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 11. Performance Strategy

- Index all foreign keys
- Index `reservations.hold_until`, `reservations.status`
- Index `orders.idempotency_key`, `inventory_adjustments.idempotency_key`
- Index `coupons.code`, `promotions.priority`
- Index `audit_logs.created_at`, `audit_logs.actor_id`
- TypeORM query builder for complex joins (avoid N+1)
- Connection pool: min 2, max 10
- Response compression via NestJS compression middleware

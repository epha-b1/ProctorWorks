# ProctorWorks — AI Self Test (Delivery Acceptance / Project Architecture Review)

---

## Business/Topic Prompt

A ProctorWorks Offline Operations Platform capable of running entirely on a single on-prem machine provides backend APIs for admins to manage a catalog-driven practice product business while also managing reservable study spaces as a physical resource. The platform exposes Authentication and Account APIs supporting local username + password login only, with configurable roles including Platform Admin (full access), Store Admin (manages catalog, promotions, and orders for an assigned store), Content Reviewer (moderation and question bank governance), and Auditor (read-only access to logs and dashboards). Resource Modeling APIs support a study room → zone → seat hierarchy with seat attributes (power outlet, quiet zone, ADA-accessible) and operational statuses (available, disabled, maintenance); seat-map configuration must be versioned, with every publish creating an immutable version record and a required change note of 20–500 characters. Seat reservation operations must enforce inventory locking: a hold expires after 15 minutes if not confirmed, and maintenance seats cannot be held. Commerce Operations APIs cover end-to-end product and inventory: SPU/SKU, categories, brands, specification attributes, tiered/member pricing, batch and expiration date tracking, publish/unpublish with reviewer approval, low-stock alerts at a configurable threshold (default 10 units), and stock-count adjustments requiring a reason code. Marketing Rule APIs support coupons (claim, distribute, redeem, expire), threshold and percentage discounts, first-order offers, campaign time windows, and per-campaign redemption caps; conflict handling must be deterministic using priority (1–1000) then "best customer value" tie-breaker, and a single order may apply at most one coupon plus one automatic promotion. Practice Assessment APIs provide question type management (objective/subjective), bulk import/export, random or rule-based paper generation, auto-grading for objective questions, wrong-answer aggregation, explanation/answer version management, and practice history with redo; a redo must regenerate a new attempt while preserving prior attempts for audit and analytics. The backend uses NestJS with TypeORM and PostgreSQL. No internet connectivity, no external APIs, no OAuth, no email/SMS, no cloud storage. Security: salted password hashing, field-level encryption for sensitive notes, masking in audit exports, row-level access by role/store, immutable audit trails retained 7 years. Performance: p95 ≤ 300ms reads, ≤ 800ms writes at 50 req/s on single Docker host.

---

## 1. Mandatory Thresholds

**1.1 Runability**
- Does `docker compose up` start cleanly with no errors?
- Does the app connect to PostgreSQL and run migrations on startup?
- Does `GET /health` return 200?
- Does `run_tests.sh` execute and produce a clear PASS/FAIL result?
- Does Swagger UI load at `http://localhost:3000/api/docs`?

**1.2 Theme Alignment**
- Is this a pure backend API platform (no UI required)?
- Does it run fully offline with no external dependencies?

---

## 2. Delivery Completeness Checklist

### Authentication and RBAC
- [ ] `POST /auth/login` — local username/password, returns JWT
- [ ] JWT middleware on all protected routes
- [ ] Role enum: platform_admin, store_admin, content_reviewer, auditor
- [ ] Store assignment on store_admin
- [ ] Wrong role → 403
- [ ] Audit log on login, logout, role change
- [ ] Account lockout after failed attempts

### Resource Modeling
- [ ] CRUD: study rooms, zones, seats
- [ ] Seat attributes: power_outlet, quiet_zone, ada_accessible (booleans)
- [ ] Seat status: available, disabled, maintenance
- [ ] Seat map draft → publish flow
- [ ] Change note validation: 20–500 chars required on publish
- [ ] Immutable SeatMapVersion created on every publish
- [ ] Version history endpoint

### Seat Reservations
- [ ] `POST /reservations` creates hold (holdUntil = now + 15 min)
- [ ] Maintenance seat → 400
- [ ] Already-held seat → 409
- [ ] `POST /reservations/:id/confirm` confirms hold
- [ ] `POST /reservations/:id/cancel` releases hold
- [ ] Background job releases expired holds every 60 seconds
- [ ] Expired hold confirm → 409

### Commerce: Products
- [ ] SPU CRUD, SKU CRUD (unique per SPU)
- [ ] Categories and brands CRUD
- [ ] Specification attributes per SKU (jsonb)
- [ ] Tiered/member pricing per SKU
- [ ] Publish/unpublish with Content Reviewer approval workflow
- [ ] Store-scoped access for store_admin (cross-store → 403)
- [ ] Low-stock alert at configurable threshold (default 10 units)

### Commerce: Inventory
- [ ] InventoryLot CRUD (batch code, expiration date, quantity)
- [ ] Stock adjustment requires reason code
- [ ] Idempotency key required on adjustments
- [ ] Duplicate idempotency key returns original response
- [ ] Expiration date alert notifications

### Commerce: Orders
- [ ] `POST /orders` requires idempotency key
- [ ] State machine: pending → confirmed → fulfilled → cancelled
- [ ] Cancellation only from pending/confirmed → else 409
- [ ] Duplicate idempotency key returns original order (200 not 201)
- [ ] Store-scoped order history

### Marketing Rules
- [ ] Coupon CRUD (code unique, validity window, remaining quantity)
- [ ] Claim, distribute, redeem, expire endpoints
- [ ] Threshold discount promotions
- [ ] Percentage discount promotions
- [ ] First-order offer detection
- [ ] Campaign time windows and per-campaign redemption caps
- [ ] Conflict resolution: priority (1–1000) then best customer value
- [ ] Deterministic tie-breaker (lower UUID if discount amounts equal)
- [ ] Max one coupon + one automatic promotion per order

### Practice Assessment: Questions
- [ ] Question CRUD (objective/subjective)
- [ ] Answer options for objective questions
- [ ] Explanation/answer versioning
- [ ] Bulk import (JSON)
- [ ] Bulk export (CSV)
- [ ] Wrong-answer aggregation stats per question
- [ ] Content Reviewer approval workflow

### Practice Assessment: Papers and Attempts
- [ ] Paper generation: random (count-based)
- [ ] Paper generation: rule-based (filter-based)
- [ ] Attempt create and submit
- [ ] Auto-grading for objective questions
- [ ] Score calculation and gradedAt timestamp
- [ ] Practice history per user
- [ ] Redo: new attempt from same paper, parent_attempt_id set
- [ ] Prior attempts preserved on redo

### Data Quality and Observability
- [ ] Data quality rules CRUD (completeness, range, uniqueness per entity type)
- [ ] Quality score 0–100 computed per entity type
- [ ] On-demand quality score computation endpoint
- [ ] Scheduled quality score recomputation (every hour)
- [ ] Freshness monitoring (24-hour staleness threshold)
- [ ] Persisted notifications for admins
- [ ] Scheduled freshness check (every hour)

### Security
- [ ] bcrypt password hashing (rounds=12)
- [ ] AES-256-GCM field-level encryption for sensitive notes
- [ ] Masking in audit log exports (`[REDACTED]` for sensitive fields)
- [ ] Row-level access: store_admin filtered by store_id on all queries
- [ ] Audit log append-only (no DELETE for app DB role)
- [ ] 7-year retention enforced at DB level
- [ ] Trace ID on every request (X-Trace-Id header + logs)

---

## 3. Engineering Quality Checklist

### Module Structure (verify each exists)
- [ ] `src/auth/` — login, JWT, password, guards
- [ ] `src/rooms/` — rooms, zones, seats, versioning
- [ ] `src/reservations/` — holds, confirm, cancel, expiry job
- [ ] `src/products/` — SPU, SKU, categories, brands
- [ ] `src/inventory/` — lots, adjustments, alerts
- [ ] `src/orders/` — state machine, idempotency
- [ ] `src/promotions/` — coupons, discounts, conflict resolution
- [ ] `src/questions/` — question bank, versioning, bulk ops
- [ ] `src/assessments/` — papers, attempts, grading
- [ ] `src/quality/` — rules, scores, freshness
- [ ] `src/notifications/` — persisted notifications
- [ ] `src/audit/` — append-only audit log
- [ ] `src/common/` — guards, interceptors, filters, pipes
- [ ] `migrations/` — TypeORM migration files
- [ ] `unit_tests/` and `API_tests/` at repo root
- [ ] `run_tests.sh` at repo root
- [ ] `docker-compose.yml`, `Dockerfile`, `.env.example`
- [ ] `README.md` with startup command, ports, test credentials

### Engineering Details
- [ ] Structured JSON logging (Winston) — not console.log
- [ ] Trace ID on every request
- [ ] class-validator on all DTOs
- [ ] Global exception filter returns `{statusCode, code, message, traceId}`
- [ ] TypeORM migrations (not sync:true in production)
- [ ] Config loaded from env (not hardcoded)
- [ ] Sensitive values never logged
- [ ] Swagger annotations on every controller

---

## 4. Security Audit Checklist (Priority)

- [ ] `POST /auth/login` — bcrypt verify, lockout enforced
- [ ] JWT guard on every protected route
- [ ] Role guard enforced per endpoint
- [ ] store_admin: all queries filtered by store_id — cross-store returns 403
- [ ] Platform Admin can access all stores
- [ ] Content Reviewer: can only approve/reject products and questions
- [ ] Auditor: read-only on audit logs and dashboards — no write access
- [ ] Audit log: no DELETE endpoint exists, app DB role has INSERT only
- [ ] Sensitive fields in audit export masked as `[REDACTED]`
- [ ] Idempotency key prevents duplicate order creation
- [ ] Maintenance seat cannot be held (400, not 409)
- [ ] Expired hold confirm returns 409 (not 200)
- [ ] Promotion conflict resolution is deterministic (same input = same output always)

---

## 5. API Endpoint Completeness Checklist

### Auth
- [ ] POST /auth/login
- [ ] GET /auth/me
- [ ] PATCH /auth/change-password
- [ ] GET /health

### Users
- [ ] GET /users
- [ ] POST /users
- [ ] PATCH /users/:id
- [ ] DELETE /users/:id

### Rooms
- [ ] GET/POST /rooms
- [ ] GET/PATCH/DELETE /rooms/:id
- [ ] GET/POST /rooms/:id/zones
- [ ] GET/POST /zones/:id/seats
- [ ] PATCH/DELETE /seats/:id
- [ ] POST /rooms/:id/publish
- [ ] GET /rooms/:id/versions

### Reservations
- [ ] POST /reservations
- [ ] POST /reservations/:id/confirm
- [ ] POST /reservations/:id/cancel
- [ ] GET /reservations

### Products
- [ ] GET/POST /products
- [ ] GET/PATCH/DELETE /products/:id
- [ ] GET/POST /products/:id/skus
- [ ] PATCH/DELETE /skus/:id
- [ ] GET/POST /categories
- [ ] GET/POST /brands
- [ ] POST /products/:id/publish
- [ ] POST /products/:id/unpublish

### Inventory
- [ ] GET/POST /inventory/lots
- [ ] PATCH /inventory/lots/:id
- [ ] POST /inventory/adjust

### Orders
- [ ] GET/POST /orders
- [ ] GET /orders/:id
- [ ] POST /orders/:id/confirm
- [ ] POST /orders/:id/cancel
- [ ] POST /orders/:id/fulfill

### Promotions
- [ ] GET/POST /promotions
- [ ] PATCH/DELETE /promotions/:id
- [ ] GET/POST /coupons
- [ ] POST /coupons/:code/claim
- [ ] POST /coupons/:code/redeem
- [ ] POST /coupons/:id/expire

### Questions
- [ ] GET/POST /questions
- [ ] GET/PATCH/DELETE /questions/:id
- [ ] POST /questions/:id/approve
- [ ] POST /questions/:id/reject
- [ ] POST /questions/import
- [ ] GET /questions/export
- [ ] GET /questions/:id/wrong-answer-stats
- [ ] GET/POST /questions/:id/explanations

### Assessments
- [ ] GET/POST /papers
- [ ] GET /papers/:id
- [ ] POST /attempts
- [ ] POST /attempts/:id/submit
- [ ] POST /attempts/:id/redo
- [ ] GET /attempts/history

### Quality
- [ ] GET/POST /quality/rules
- [ ] GET /quality/scores
- [ ] POST /quality/scores/:entityType/compute

### Notifications
- [ ] GET /notifications
- [ ] PATCH /notifications/:id/read

### Audit
- [ ] GET /audit-logs
- [ ] GET /audit-logs/export

---

## 6. Test Coverage Assessment

### Required Unit Tests
- [ ] auth: bcrypt hash and verify
- [ ] auth: JWT sign and verify
- [ ] auth: role check logic
- [ ] reservations: hold expiry logic
- [ ] reservations: maintenance seat rejection
- [ ] orders: state machine transitions (all valid + invalid)
- [ ] orders: idempotency key deduplication
- [ ] promotions: conflict resolution priority sort
- [ ] promotions: best customer value tie-breaker
- [ ] promotions: deterministic UUID tie-breaker
- [ ] promotions: redemption cap enforcement
- [ ] assessments: auto-grading objective questions
- [ ] assessments: redo preserves parent_attempt_id
- [ ] quality: score computation 0–100

### Required API Tests
- [ ] Login success → JWT returned
- [ ] Login wrong password → 401
- [ ] Wrong role → 403
- [ ] store_admin cross-store access → 403
- [ ] Seat hold → 201
- [ ] Maintenance seat hold → 400
- [ ] Already-held seat → 409
- [ ] Confirm expired hold → 409
- [ ] Seat map publish with short note → 400
- [ ] Seat map publish with valid note → 201 + immutable version
- [ ] Order create with idempotency key → 201
- [ ] Order create duplicate key → 200 + same order
- [ ] Order cancel from fulfilled → 409
- [ ] Inventory adjust with reason code → 201
- [ ] Inventory adjust duplicate key → 200
- [ ] Coupon claim → 200
- [ ] Coupon claim expired → 409
- [ ] Order with coupon + auto promotion → both applied
- [ ] Order with two auto promotions → only highest priority applied
- [ ] Bulk question import → 200 + count
- [ ] Attempt submit → graded score returned
- [ ] Redo → new attempt, prior preserved
- [ ] Audit log read as auditor → 200
- [ ] Audit log read as store_admin → 403
- [ ] Audit log export → sensitive fields masked

---

## 7. Business Logic Hard Questions

The inspector must verify the implementation answers each correctly:

1. If two promotions have priority=500 and the same discount amount, which one wins? (Lower UUID — verify the tie-breaker is deterministic and tested)

2. If a store_admin tries to GET `/orders` without a store assignment, what happens? (403 or empty list — verify the behavior is defined and consistent)

3. If a seat hold expires and the user tries to confirm it, what is the response? (409 CONFLICT — verify the confirm endpoint checks holdUntil before confirming)

4. If a seat map is published with a change note of exactly 20 characters, does it succeed? (Yes — verify boundary is inclusive: 20 ≤ length ≤ 500)

5. If a seat map is published with a change note of 19 characters, does it fail? (Yes — 400 VALIDATION_ERROR)

6. If an order idempotency key is reused after 24 hours, is it treated as a new order or duplicate? (New order — keys expire after 24 hours, verify expiry logic)

7. If a redo is performed on an attempt that was itself a redo, does the chain preserve all prior attempts? (Yes — parent_attempt_id links form a chain, all preserved)

8. If a Content Reviewer tries to create a product, what happens? (403 — Content Reviewer can only approve/reject, not create)

9. If an Auditor tries to POST to any endpoint, what happens? (403 — Auditor is read-only)

10. If the low-stock threshold is set to 0, does the alert still fire? (No — threshold of 0 means no alert. Verify the comparison is `quantity < threshold` not `quantity <= threshold`)

11. If a coupon's remaining_quantity reaches 0, what status does it get? (exhausted — verify the status transition happens atomically with the last redemption)

12. If auto-grading runs on a subjective question, what happens? (Skipped — only objective questions are auto-graded. Subjective questions have null is_correct)

13. If the audit log DB role accidentally has DELETE permission, what is the risk? (7-year retention violated — verify at DB level with a test that attempts DELETE and gets permission denied)

---

## 8. Task 73/17 Failure Prevention Checklist

These are issues that caused partial passes on similar projects. Verify each explicitly:

### 8.1 No raw tokens or sensitive data in API responses
- [ ] Login response contains JWT token but NOT password hash
- [ ] Audit log export masks password_hash and encrypted fields as `[REDACTED]`
- [ ] No stack traces in error responses — only `{statusCode, code, message, traceId}`

### 8.2 Security constraints enforced, not just configured
- [ ] store_admin cross-store test actually sends request and verifies 403 (not just middleware existence)
- [ ] Audit log DELETE test actually attempts DELETE at DB level and verifies permission denied
- [ ] Maintenance seat test actually sends hold request and verifies 400

### 8.3 Every API test logs actual request and response
- [ ] All API tests use a `logStep(method, path, statusCode, responseBody)` helper
- [ ] Test output shows `→ POST /auth/login` and `← 200 {...}` for every call

### 8.4 No ReDoS or unsafe input evaluation
- [ ] Promotion conflict resolution uses numeric comparison only — no regex on user input
- [ ] Data quality rule config is validated against a schema before storage
- [ ] Bulk import validates each question before inserting — malformed input returns 400 with details

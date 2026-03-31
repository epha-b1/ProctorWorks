# ProctorWorks — Feature Build Order

Build one slice at a time. Each slice must be fully working (implementation + tests) before moving to the next.

---

## Slice 1 — Project Foundation
Done when:
- NestJS app boots with TypeORM connected to PostgreSQL
- `docker compose up` starts cleanly
- Migrations run on startup
- Structured logging with trace IDs on every request
- Health endpoint `GET /health` returns 200
- `.env.example` has all required vars
- `run_tests.sh` runs unit + API tests

---

## Slice 2 — Authentication and RBAC
Done when:
- `POST /auth/login` validates username/password, returns JWT
- JWT middleware protects all routes
- Role enum: platform_admin, store_admin, content_reviewer, auditor
- Store assignment on store_admin accounts
- Wrong role → 403
- Account lockout after 5 failed attempts (15 min lockout)
- Audit log on login, logout, role change
- Unit tests: password hashing, JWT validation, role checks, lockout
- API tests: login, wrong password, lockout, wrong role 403

---

## Slice 3 — Resource Modeling (Rooms, Zones, Seats)
Done when:
- CRUD for study rooms, zones, seats
- Seat attributes: power_outlet, quiet_zone, ada_accessible
- Seat status: available, disabled, maintenance
- Seat map draft → publish flow
- Change note validation (20–500 chars) on publish
- Immutable SeatMapVersion created on publish
- Version history endpoint
- API tests: CRUD, publish with invalid note, version history

---

## Slice 4 — Seat Reservations
Done when:
- `POST /reservations` creates hold (holdUntil = now + 15 min)
- `GET /reservations` lists reservations (filtered by user or seat)
- Maintenance seat hold returns 400
- Already-held seat returns 409
- `POST /reservations/:id/confirm` confirms hold
- `POST /reservations/:id/cancel` releases hold
- Confirm on expired hold returns 409
- Background job releases expired holds every 60 seconds
- Unit tests: hold expiry logic, maintenance seat rejection, expired confirm
- API tests: hold, confirm, cancel, expired hold confirm 409, maintenance seat 400

---

## Slice 5 — Commerce: Products and Catalog
Done when:
- SPU CRUD, SKU CRUD (unique per SPU)
- Categories and brands CRUD
- Specification attributes per SKU
- Tiered/member pricing per SKU
- Publish/unpublish with Content Reviewer approval
- Store-scoped access for store_admin
- API tests: CRUD, publish workflow, cross-store 403

---

## Slice 6 — Commerce: Inventory
Done when:
- InventoryLot CRUD (batch code, expiration date, quantity)
- Stock adjustment with required reason code
- Idempotency key on adjustments
- Low-stock notification at configurable threshold (default 10)
- Expiration date alert notifications
- Unit tests: idempotency, low-stock trigger
- API tests: adjustment, duplicate key, low-stock notification

---

## Slice 7 — Commerce: Orders
Done when:
- `POST /orders` requires idempotency key
- State machine: pending → confirmed → fulfilled → cancelled
- `POST /orders/:id/confirm`, `POST /orders/:id/fulfill`, `POST /orders/:id/cancel`
- Order line items linked to SKUs
- Duplicate idempotency key returns original order (200)
- Cancellation only from pending/confirmed → else 409
- Store-scoped order history
- Unit tests: state machine transitions (all valid + invalid), idempotency
- API tests: create, confirm, fulfill, cancel, duplicate key, cancel from fulfilled 409

---

## Slice 8 — Marketing Rules: Promotions and Coupons
Done when:
- Coupon CRUD (code, validity window, remaining quantity)
- Claim, distribute, redeem endpoints
- `POST /coupons/:id/expire` manually expires a coupon
- Threshold and percentage discount promotions
- First-order offer detection
- Campaign time windows and per-campaign redemption caps
- Conflict resolution: priority then best customer value
- Deterministic tie-breaker: lower UUID if discount amounts equal
- One coupon + one automatic promotion max per order
- Unit tests: conflict resolution, tie-breaker determinism, cap enforcement
- API tests: claim, redeem, expired coupon 409, conflict resolution, cap reached

---

## Slice 9 — Practice Assessment: Questions
Done when:
- Question CRUD (objective/subjective)
- Answer options for objective questions
- Explanation/answer versioning
- Bulk import (JSON) and export (CSV)
- Wrong-answer aggregation stats per question
- Content Reviewer approval workflow
- API tests: CRUD, bulk import/export, wrong-answer stats

---

## Slice 10 — Practice Assessment: Papers and Attempts
Done when:
- Paper generation: random or rule-based
- Attempt create and submit
- Auto-grading for objective questions
- Score calculation
- Practice history per user
- Redo: new attempt from same paper, preserves prior attempts
- Unit tests: auto-grading, redo preserves history
- API tests: full attempt flow, redo, history

---

## Slice 11 — Data Quality and Observability
Done when:
- Data quality rules CRUD per entity type
- Quality score computation (0–100) on demand and scheduled
- Freshness monitoring (24-hour threshold)
- Persisted notifications for admins
- Scheduled jobs for quality and freshness
- API tests: quality score, freshness alert, notifications

---

## Slice 12 — Security Hardening and Audit Log
Done when:
- AES-256-GCM field-level encryption for sensitive notes
- Masking in audit log exports
- Append-only audit_logs (no DELETE for app DB role)
- 7-year retention enforced at DB level
- Audit log query endpoint (Auditor + Platform Admin)
- API tests: audit log read, masking in export, 403 for wrong role

---

## Slice 13 — Final Polish
Done when:
- `run_tests.sh` passes all unit + API tests
- `docker compose up` cold start works
- README has startup command, service addresses, test credentials
- No node_modules, dist, or compiled output in repo
- No real credentials in any config file
- Swagger UI available at `/api/docs`
- All p95 read queries have proper indexes

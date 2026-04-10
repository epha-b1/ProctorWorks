# Required Document Description: Business Logic Questions Log

This file records business-level ambiguities from the prompt and implementation decisions.
Each entry follows exactly: Question + My Understanding/Hypothesis + Solution.

## 1) Store Admin Scope — Can They See Other Stores?
Question: The prompt says Store Admin manages catalog, promotions, and orders for an assigned store. Does this mean they are hard-scoped to one store and cannot see any data from other stores?
My Understanding/Hypothesis: Yes — Store Admin is strictly scoped to their assigned store. All queries for products, orders, promotions, and inventory are filtered by `store_id`. Cross-store access returns 403.
Solution: Every repository query for store-scoped resources checks `store_id` against the authenticated user's assigned store. Platform Admin can see all stores.

## 2) Seat Map Versioning — What Triggers a New Version?
Question: The prompt says every publish creates an immutable version record. Does editing a seat map without publishing create a draft, or does every save create a version?
My Understanding/Hypothesis: Edits are saved as a mutable draft. Publishing the draft creates an immutable `SeatMapVersion` record with a required change note (20–500 chars). The current live version is the latest published version.
Solution: `seat_map_versions` table stores published snapshots. A `seat_map_draft` table (or draft flag) holds unpublished changes. `POST /seat-maps/:id/publish` validates the change note and creates the immutable version.

## 3) Seat Reservation Hold — What Happens on Expiry?
Question: A hold expires after 15 minutes if not confirmed. Does the system automatically release expired holds, or does the next request trigger cleanup?
My Understanding/Hypothesis: A background job runs every minute to release expired holds (set `holdUntil < now()` → status back to available). Additionally, the hold endpoint checks for expiry before creating a new hold.
Solution: Scheduled job in NestJS using `@nestjs/schedule` runs every 60 seconds to release expired holds. Hold creation also checks for existing expired holds on the same seat.

## 4) Promotion Conflict — "Best Customer Value" Tie-Breaker
Question: When two promotions have the same priority, the tie-breaker is "best customer value." How is this calculated — highest discount amount, highest discount percentage, or something else?
My Understanding/Hypothesis: Best customer value = the promotion that results in the lowest final order total for the customer. Calculate the discount amount for each tied promotion against the order total and apply the one with the higher discount amount.
Solution: Promotion engine calculates effective discount for each tied promotion, selects the one with the highest discount amount. If still tied (same discount amount), use the lower promotion ID as a deterministic final tie-breaker.

## 5) Order State Machine — What Are the States?
Question: The prompt mentions an order state machine but doesn't define the states.
My Understanding/Hypothesis: States: `pending` → `confirmed` → `fulfilled` → `cancelled`. Cancellation is only allowed from `pending` or `confirmed`. Refunds are handled as a separate record, not a state.
Solution: `orders.status` enum: pending, confirmed, fulfilled, cancelled. State transitions enforced in the service layer with explicit allowed-transition checks.

## 6) Idempotency Key — Scope and Behavior
Question: The prompt requires idempotency keys on order creation and inventory adjustments. What is the scope — per user, per store, or global?
My Understanding/Hypothesis: Idempotency keys are globally unique per operation type. A duplicate key on order creation returns the original order response (200, not 201) without creating a new order.
Solution: `idempotency_keys` table stores `(key, operation_type, response_body, created_at)`. On duplicate key: return stored response. Keys expire after 24 hours.

## 7) Audit Trail Retention — 7 Years
Question: The prompt requires audit trails retained for 7 years. Does this mean the DB rows must never be deleted, or can they be archived to a separate table/file?
My Understanding/Hypothesis: Audit log rows are never deleted from the primary `audit_logs` table. The application DB role has no DELETE permission on `audit_logs`. After 7 years, rows may be archived to a cold storage table but the primary table retains them.
Solution: PostgreSQL role for the app has INSERT-only on `audit_logs`. A separate archival job (optional) can move rows older than 7 years to `audit_logs_archive`.

## 8) Data Quality Score — What Datasets?
Question: The prompt says configurable data quality rules produce a 0–100 quality score per dataset. What counts as a dataset — a table, a product, an order?
My Understanding/Hypothesis: A dataset is a logical entity type: Products, Orders, Questions, Users, Inventory. Each entity type has configurable rules (completeness, range, uniqueness). The quality score is computed on demand or on a schedule for each entity type.
Solution: `data_quality_rules` table stores rules per entity type. `data_quality_scores` table stores the latest computed score per entity type with timestamp. A scheduled job recomputes scores every hour.

## 9) Field-Level Encryption — Which Fields?
Question: The prompt says sensitive notes require field-level encryption. Which fields exactly?
My Understanding/Hypothesis: Fields to encrypt: `users.notes` (if any), `orders.internal_notes`, `audit_logs.detail` (for sensitive operations). Encryption uses AES-256-GCM with key from env config.
Solution: Confirm the exact list of fields requiring encryption.

## 10) Bulk Import/Export for Questions — What Format?
Question: The prompt requires bulk import/export for questions. What file format?
My Understanding/Hypothesis: CSV for export (simple, evaluator-friendly). JSON for import (supports nested structure for options/answers). Both endpoints are synchronous for reasonable batch sizes (up to 1000 questions).
Solution: `POST /questions/import` accepts JSON body with array of questions. `GET /questions/export` returns CSV. Both require Content Reviewer or Platform Admin role.

## 11) Wrong-Answer Aggregation — What Does It Aggregate?
Question: The prompt mentions wrong-answer aggregation. What is the output — a report per question showing how many times each wrong answer was chosen?
My Understanding/Hypothesis: For each objective question, track how many times each incorrect option was selected across all attempts. Expose as `GET /questions/:id/wrong-answer-stats` returning option → count mapping.
Solution: `attempt_answers` table stores per-question per-attempt selected option. Aggregation query groups by question_id and selected_option where correct=false.

## 12) Practice History Redo — Does It Copy the Same Questions?
Question: A redo must regenerate a new attempt while preserving prior attempts. Does redo use the same question set as the original, or regenerate using the same rules?
My Understanding/Hypothesis: Redo regenerates using the same paper generation rules (same paper_id), not the same question instances. This means a redo may get different random questions if the paper uses random selection. Prior attempts are preserved and linked to the same paper.
Solution: `attempts` table has `paper_id` and `parent_attempt_id` (nullable). Redo creates a new attempt with the same `paper_id` and sets `parent_attempt_id` to the original attempt ID.

## 13) Low-Stock Alert — How Is It Delivered?
Question: The prompt says low-stock alerts at a configurable threshold. How are alerts delivered — email, in-app notification, or both?
My Understanding/Hypothesis: Alerts are persisted as notifications in the `notifications` table (local alerting only, no email/SMS per the offline constraint). Platform Admin and Store Admin can query their notifications via API.
Solution: `notifications` table stores `(user_id, type, message, read, created_at)`. A background job checks inventory levels every 15 minutes and creates notifications for items below threshold.

## 14) Freshness Monitoring — What Is Monitored?
Question: The prompt says freshness monitoring with a 24-hour staleness threshold. What data is monitored for freshness?
My Understanding/Hypothesis: Monitored datasets: Products (last updated), Inventory (last stock adjustment), Questions (last reviewed). If any dataset hasn't been updated in 24 hours, a staleness notification is created for admins.
Solution: `data_freshness_checks` table stores last-checked timestamp per entity type. Scheduled job runs every hour and creates notifications for stale datasets.

## 15) Performance — p95 ≤ 300ms — How Is This Enforced?
Question: The prompt specifies p95 ≤ 300ms for reads. Is this a hard requirement that must be tested, or a design target?
My Understanding/Hypothesis: Design target enforced through proper indexing, query optimization, and connection pooling. Not tested with load tests in the submission, but documented in the README with the indexing strategy.
Solution: Add database indexes on all foreign keys and frequently queried columns. Use TypeORM query builder for complex queries to avoid N+1. Document index strategy in `docs/design.md`.

## 16) Stores CRUD — Does Platform Admin Manage Stores?
Question: The data model has a `stores` table and store_admin is scoped to a store, but the API spec doesn't define explicit store CRUD endpoints. Should Platform Admin be able to create/list/update/delete stores?
My Understanding/Hypothesis: Yes — Platform Admin needs basic CRUD for stores so that store_admin users can be assigned to them. Endpoints: `GET /stores`, `POST /stores`, `PATCH /stores/:id`, `DELETE /stores/:id` (Platform Admin only).
Solution: Add a `stores` module with basic CRUD, protected by Platform Admin role.

## 17) Seat Status Transitions — Free or Restricted?
Question: Can seats transition between any statuses (available, disabled, maintenance) freely, or are there restricted state transitions?
My Understanding/Hypothesis: Free transitions — a `PATCH /seats/:id` with `{status: "maintenance"}` is allowed from any current status. The only enforcement is that a seat in maintenance cannot have active holds.
Solution: PATCH endpoint allows any valid status value. If transitioning to maintenance, any active holds on the seat should be expired.

## 18) Order Fulfill Endpoint — Missing from API Spec
Question: The self-test checklist (Section 5) lists `POST /orders/:id/fulfill` but it's not in the API spec YAML. Should it exist?
My Understanding/Hypothesis: Yes — the state machine is pending → confirmed → fulfilled → cancelled, so a fulfill endpoint is required. `POST /orders/:id/fulfill` transitions from confirmed to fulfilled.
Solution: Add the endpoint to the orders controller alongside confirm and cancel.

## 19) Coupon Distribute — What Does It Mean?
Question: The prompt mentions "distribute" as a coupon operation alongside claim, redeem, and expire. The API spec has a claim endpoint but not distribute. What is distribute?
My Understanding/Hypothesis: Distribute = admin assigns a coupon to specific users (batch operation). `POST /coupons/:id/distribute` with `{userIds: [...]}` creates coupon_claims records for each user without them needing to claim it themselves.
Solution: Add distribute endpoint that creates claims for specified users.

## 20) SKU Price Tiers — Endpoint or Nested?
Question: The data model has `sku_price_tiers` as a separate table, but there's no explicit endpoint for managing price tiers. Should they have their own CRUD or be managed inline with SKU create/update?
My Understanding/Hypothesis: Managed inline — when creating or updating a SKU, include a `priceTiers` array in the request body. No standalone price tier endpoints.
Solution: SKU create/update DTOs accept optional `priceTiers: [{tierName, priceCents}]`. Service handles upsert/delete of tiers within the SKU transaction.

## 21) Question Answer Versioning — Is It In Scope?
Question: The prompt requires versioning for question content but doesn't explicitly state whether **answers/options** themselves are version-tracked, or only the textual **explanations**. Should `question_options` carry version metadata so that historical attempts always grade against the option set that was live at submission time?
My Understanding/Hypothesis: Out of scope. The prompt mentions versioning in the context of (a) seat maps (immutable published snapshots) and (b) question **explanations** (so the canonical "why this answer is correct" rationale evolves without losing history). It does NOT call out the answer/option set as version-tracked, and the data model intentionally treats `question_options` as a mutable extension of the question itself — editing an option after attempts exist is a content-correction action, not a versioned change.
Solution: Versioning is implemented at TWO concrete locations and NO others:
1. `seat_map_versions` table — immutable seat-map snapshots with monotone `version_number` per `room_id`, enforced by the `UNIQUE (room_id, version_number)` constraint and the publish flow in the rooms module.
2. `question_explanations` table — explanation history with monotone `version_number` per `question_id`, enforced by `UNIQUE (question_id, version_number)` and the auto-increment in `QuestionsService.addExplanation`.

Anything else (`question_options`, `attempt_answers`, `papers`, `attempts`) is intentionally **non-versioned** — these are either mutable working state, immutable history rows, or pure derivatives of the rule. A unit test in `unit_tests/quality.spec.ts` (and a complementary entity-metadata check in `unit_tests/auth.spec.ts`) asserts the versioning surface so that anyone adding a `version_number` column to a non-versioned entity in the future trips a regression test before the change ever lands.

audit_report-2 P1-7: this entry exists specifically so future readers (and future audits) have a written, tested source of truth for the versioning policy rather than having to infer it from the schema.

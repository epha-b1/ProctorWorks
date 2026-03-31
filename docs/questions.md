# Questions and Clarifications — ProctorWorks

---

## 1. Store Admin Scope — Can They See Other Stores?

**Question:** The prompt says Store Admin manages catalog, promotions, and orders for an assigned store. Does this mean they are hard-scoped to one store and cannot see any data from other stores?

**Assumption:** Yes — Store Admin is strictly scoped to their assigned store. All queries for products, orders, promotions, and inventory are filtered by `store_id`. Cross-store access returns 403.

**Solution:** Every repository query for store-scoped resources checks `store_id` against the authenticated user's assigned store. Platform Admin can see all stores.

---

## 2. Seat Map Versioning — What Triggers a New Version?

**Question:** The prompt says every publish creates an immutable version record. Does editing a seat map without publishing create a draft, or does every save create a version?

**Assumption:** Edits are saved as a mutable draft. Publishing the draft creates an immutable `SeatMapVersion` record with a required change note (20–500 chars). The current live version is the latest published version.

**Solution:** `seat_map_versions` table stores published snapshots. A `seat_map_draft` table (or draft flag) holds unpublished changes. `POST /seat-maps/:id/publish` validates the change note and creates the immutable version.

---

## 3. Seat Reservation Hold — What Happens on Expiry?

**Question:** A hold expires after 15 minutes if not confirmed. Does the system automatically release expired holds, or does the next request trigger cleanup?

**Assumption:** A background job runs every minute to release expired holds (set `holdUntil < now()` → status back to available). Additionally, the hold endpoint checks for expiry before creating a new hold.

**Solution:** Scheduled job in NestJS using `@nestjs/schedule` runs every 60 seconds to release expired holds. Hold creation also checks for existing expired holds on the same seat.

---

## 4. Promotion Conflict — "Best Customer Value" Tie-Breaker

**Question:** When two promotions have the same priority, the tie-breaker is "best customer value." How is this calculated — highest discount amount, highest discount percentage, or something else?

**Assumption:** Best customer value = the promotion that results in the lowest final order total for the customer. Calculate the discount amount for each tied promotion against the order total and apply the one with the higher discount amount.

**Solution:** Promotion engine calculates effective discount for each tied promotion, selects the one with the highest discount amount. If still tied (same discount amount), use the lower promotion ID as a deterministic final tie-breaker.

---

## 5. Order State Machine — What Are the States?

**Question:** The prompt mentions an order state machine but doesn't define the states.

**Assumption:** States: `pending` → `confirmed` → `fulfilled` → `cancelled`. Cancellation is only allowed from `pending` or `confirmed`. Refunds are handled as a separate record, not a state.

**Solution:** `orders.status` enum: pending, confirmed, fulfilled, cancelled. State transitions enforced in the service layer with explicit allowed-transition checks.

---

## 6. Idempotency Key — Scope and Behavior

**Question:** The prompt requires idempotency keys on order creation and inventory adjustments. What is the scope — per user, per store, or global?

**Assumption:** Idempotency keys are globally unique per operation type. A duplicate key on order creation returns the original order response (200, not 201) without creating a new order.

**Solution:** `idempotency_keys` table stores `(key, operation_type, response_body, created_at)`. On duplicate key: return stored response. Keys expire after 24 hours.

---

## 7. Audit Trail Retention — 7 Years

**Question:** The prompt requires audit trails retained for 7 years. Does this mean the DB rows must never be deleted, or can they be archived to a separate table/file?

**Assumption:** Audit log rows are never deleted from the primary `audit_logs` table. The application DB role has no DELETE permission on `audit_logs`. After 7 years, rows may be archived to a cold storage table but the primary table retains them.

**Solution:** PostgreSQL role for the app has INSERT-only on `audit_logs`. A separate archival job (optional) can move rows older than 7 years to `audit_logs_archive`.

---

## 8. Data Quality Score — What Datasets?

**Question:** The prompt says configurable data quality rules produce a 0–100 quality score per dataset. What counts as a dataset — a table, a product, an order?

**Assumption:** A dataset is a logical entity type: Products, Orders, Questions, Users, Inventory. Each entity type has configurable rules (completeness, range, uniqueness). The quality score is computed on demand or on a schedule for each entity type.

**Solution:** `data_quality_rules` table stores rules per entity type. `data_quality_scores` table stores the latest computed score per entity type with timestamp. A scheduled job recomputes scores every hour.

---

## 9. Field-Level Encryption — Which Fields?

**Question:** The prompt says sensitive notes require field-level encryption. Which fields exactly?

**Assumption:** Fields to encrypt: `users.notes` (if any), `orders.internal_notes`, `audit_logs.detail` (for sensitive operations). Encryption uses AES-256-GCM with key from env config.

**Decision needed:** Confirm the exact list of fields requiring encryption.

---

## 10. Bulk Import/Export for Questions — What Format?

**Question:** The prompt requires bulk import/export for questions. What file format?

**Assumption:** CSV for export (simple, evaluator-friendly). JSON for import (supports nested structure for options/answers). Both endpoints are synchronous for reasonable batch sizes (up to 1000 questions).

**Solution:** `POST /questions/import` accepts JSON body with array of questions. `GET /questions/export` returns CSV. Both require Content Reviewer or Platform Admin role.

---

## 11. Wrong-Answer Aggregation — What Does It Aggregate?

**Question:** The prompt mentions wrong-answer aggregation. What is the output — a report per question showing how many times each wrong answer was chosen?

**Assumption:** For each objective question, track how many times each incorrect option was selected across all attempts. Expose as `GET /questions/:id/wrong-answer-stats` returning option → count mapping.

**Solution:** `attempt_answers` table stores per-question per-attempt selected option. Aggregation query groups by question_id and selected_option where correct=false.

---

## 12. Practice History Redo — Does It Copy the Same Questions?

**Question:** A redo must regenerate a new attempt while preserving prior attempts. Does redo use the same question set as the original, or regenerate using the same rules?

**Assumption:** Redo regenerates using the same paper generation rules (same paper_id), not the same question instances. This means a redo may get different random questions if the paper uses random selection. Prior attempts are preserved and linked to the same paper.

**Solution:** `attempts` table has `paper_id` and `parent_attempt_id` (nullable). Redo creates a new attempt with the same `paper_id` and sets `parent_attempt_id` to the original attempt ID.

---

## 13. Low-Stock Alert — How Is It Delivered?

**Question:** The prompt says low-stock alerts at a configurable threshold. How are alerts delivered — email, in-app notification, or both?

**Assumption:** Alerts are persisted as notifications in the `notifications` table (local alerting only, no email/SMS per the offline constraint). Platform Admin and Store Admin can query their notifications via API.

**Solution:** `notifications` table stores `(user_id, type, message, read, created_at)`. A background job checks inventory levels every 15 minutes and creates notifications for items below threshold.

---

## 14. Freshness Monitoring — What Is Monitored?

**Question:** The prompt says freshness monitoring with a 24-hour staleness threshold. What data is monitored for freshness?

**Assumption:** Monitored datasets: Products (last updated), Inventory (last stock adjustment), Questions (last reviewed). If any dataset hasn't been updated in 24 hours, a staleness notification is created for admins.

**Solution:** `data_freshness_checks` table stores last-checked timestamp per entity type. Scheduled job runs every hour and creates notifications for stale datasets.

---

## 15. Performance — p95 ≤ 300ms — How Is This Enforced?

**Question:** The prompt specifies p95 ≤ 300ms for reads. Is this a hard requirement that must be tested, or a design target?

**Assumption:** Design target enforced through proper indexing, query optimization, and connection pooling. Not tested with load tests in the submission, but documented in the README with the indexing strategy.

**Solution:** Add database indexes on all foreign keys and frequently queried columns. Use TypeORM query builder for complex queries to avoid N+1. Document index strategy in `docs/design.md`.

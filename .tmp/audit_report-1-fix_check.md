# audit_report-1 Fix Check (Static)

## Verdict
- **All issues from `./.tmp/audit_report-1.md` are addressed.**
- **Addressed:** 7 / 7
- **Open:** 0 / 7
- Boundary: static inspection only — type-check passes (`npx tsc --noEmit` exit 0); affected unit suites run green (`npx jest unit_tests/orders.spec.ts unit_tests/promotions.spec.ts unit_tests/assessments.spec.ts unit_tests/inventory.spec.ts` → 83 passed).

## Issue-by-issue status

### 1) Blocker — Inventory idempotency non-atomic race
- **Status:** **Fixed** (closed in the prior pass; carried over for completeness).
- **Code evidence:** transaction + row lock + atomic insert-or-ignore + replay path without quantity mutation in `repo/src/inventory/inventory.service.ts:129-236` (key spans: lock at `:140-147`, scope re-check at `:152-163`, ON CONFLICT DO NOTHING insert at `:169-184`, duplicate path with no quantity mutation at `:186-199`, fresh-insert delta at `:201-214`).
- **Test evidence:** concurrent duplicate test in `repo/API_tests/inventory.api.spec.ts:357-454`, simulated concurrency in `repo/unit_tests/inventory.spec.ts:212-308`.

### 2) High — Store Admin can generate papers for arbitrary store via query parameter
- **Status:** **Fixed**.
- **Code evidence:**
  - Controller now passes the full `user` object instead of just `userId`, so the service can enforce JWT scope: `repo/src/assessments/assessments.controller.ts:48-58`.
  - New scope-resolver `resolveTargetStoreForGenerate(user, requestedStoreId)` in `repo/src/assessments/assessments.service.ts:84-104` forces the JWT store for `store_admin` and throws `ForbiddenException` (`:97-100`) on any cross-store override. `platform_admin` / `content_reviewer` keep optional cross-store targeting via the query param.
  - `generatePaper(...)` consumes the resolved store id at `repo/src/assessments/assessments.service.ts:106-178`.
- **Test evidence:**
  - Unit: `repo/unit_tests/assessments.spec.ts:189-322` covers (a) store_admin override → 403 with no persistence, (b) store_admin no-override → JWT-scoped, (c) matching override allowed, (d) platform_admin cross-store still works.
  - API: `repo/API_tests/remediation.api.spec.ts:892-994` (`F-P2: Assessments paper generate tenant isolation`) — store B → store A escape attempt 403 + no leak; positive same-store control; matching override allowed; platform_admin cross-store still works.

### 3) High — Order promotion resolution can apply coupon from different store
- **Status:** **Fixed**.
- **Code evidence:** `resolvePromotions` now requires `coupon.store_id === storeId` before applying. Mismatch is logged and silently ignored (deterministic, no info leak): `repo/src/promotions/promotions.service.ts:385-413` (key check at `:393`, gating at `:397`, mismatch warn at `:404-410`).
- **Test evidence:**
  - Unit: `repo/unit_tests/promotions.spec.ts:410-497` (`cross-store coupon binding`) — foreign coupon → no discount + null selectedCoupon; same-store control still applies the discount.
  - API: `repo/API_tests/remediation.api.spec.ts:745-878` (`F-P3: Order promotion cross-store coupon binding`) — store_admin B redeeming a store-A coupon → discount=0 + coupon_id=null; same-store coupon control passes 1500c discount.

### 4) High — Order idempotency lookup is globally keyed and can leak cross-scope response
- **Status:** **Fixed**.
- **Code evidence:**
  - Entity is now scoped by `(operation_type, actor_id, store_id, key)` with a synthetic `id` PK so `store_id` can stay nullable for platform-admin / cross-store operations: `repo/src/orders/entities/idempotency-key.entity.ts:1-50`.
  - Composite UNIQUE index + backfill migration: `repo/migrations/1711900000003-ScopeIdempotencyKeys.ts:1-127` (key spans: backfill via orders join `:65-74`, surrogate PK install `:80-89`, `COALESCE(store_id, sentinel)` unique index `:96-107`, helper IDX `:113-117`, backward-safe down() `:119-126`).
  - Service lookup is now scope-keyed, and the read-back additionally re-verifies `store_id` + `user_id` of the resolved order as defense-in-depth: `repo/src/orders/orders.service.ts:54-106` (scoped findOne `:74-81`, resolved-order scope check `:92-98`, refuse-to-leak NotFound `:100-105`). The persisted record now carries the same scoping fields: `repo/src/orders/orders.service.ts:194-204`.
- **Test evidence:**
  - Unit: `repo/unit_tests/orders.spec.ts:159-272` — same-scope dedup uses the new `where` shape (`:184-192`) and resolves by `orderId` (not raw key, `:194-198`); cross-tenant collision returns a brand new order (`:214-240`); store_id mismatch triggers NotFound (`:242-271`); user_id mismatch triggers NotFound (`:273-303`).
  - API: `repo/API_tests/remediation.api.spec.ts:628-742` (`F-P4: Order idempotency cross-tenant non-leakage`) — store A and store B both create orders with the same `idempotencyKey`; B gets its OWN fresh order (different id, store=B, total reflecting store-B SKU); same-tenant replays still dedupe in both stores.

### 5) Medium — Publish workflow bypasses explicit reviewer-approval governance
- **Status:** **Fixed**.
- **Code evidence:**
  - `publishProduct` now ALWAYS lands on `pending_review` for every role; no direct-publish bypass for content_reviewer/platform_admin: `repo/src/products/products.service.ts:109-160`.
  - New explicit reviewer-approval transition `approveProduct` (`pending_review → published`, requires content_reviewer or platform_admin, conflict-checks the source state): `repo/src/products/products.service.ts:168-190`.
  - New endpoint `POST /products/:id/approve` with separate audit action `approve_product`: `repo/src/products/products.controller.ts:155-192`.
- **Test evidence:**
  - API (existing flow updated): `repo/API_tests/products.api.spec.ts:307-339` — `/publish` lands on `pending_review` for platform_admin (no bypass); `/approve` then transitions to `published`.
  - API (governance regression): `repo/API_tests/remediation.api.spec.ts:511-622` (`F-P5: Publish requires explicit reviewer approval`) — store_admin /publish → pending_review; **platform_admin /publish ALSO lands on pending_review** (bypass closed); content_reviewer /approve → published; store_admin cannot /approve → 403; approving an already-published product → 409.

### 6) Medium — OpenAPI spec drift (`/stores`, `/auth/logout`)
- **Status:** **Fixed**.
- **Doc evidence:**
  - `/auth/logout` POST documented at `docs/api-spec.md:94-112` (security: bearerAuth, 204 success, 401 error).
  - `/stores` GET + POST documented at `docs/api-spec.md:229-296` (platform_admin restriction, 200/201/403 statuses, request/response schemas).
  - `/stores/{id}` PATCH + DELETE documented at `docs/api-spec.md:298-360` (200/204 success, 403/404 errors).
  - Bonus: the publish flow contract change in §5 is also reflected in the spec — `/products/{id}/publish` now documents the `pending_review` outcome at `docs/api-spec.md:660-691`, and the new `/products/{id}/approve` endpoint is documented at `docs/api-spec.md:693-728`.

### 7) Low — Dead branch in reservations list ownership logic
- **Status:** **Fixed**.
- **Code evidence:** the unreachable `isAdmin ? undefined : user.id` branch is removed; the handler now matches the current admin-only role policy and the rationale is documented inline: `repo/src/reservations/reservations.controller.ts:45-57`.
- **Test evidence:** existing admin happy-path test plus a new role-gate regression that proves a non-admin role returns **403** (never a silent self-filter), in `repo/API_tests/reservations.api.spec.ts:302-365`.

## Cross-cutting verification
- **Type-check:** `npx tsc --noEmit` → exit 0 (clean across all touched files including new migration, entity, service, controller, and tests).
- **Targeted unit suites:** `npx jest unit_tests/orders.spec.ts unit_tests/promotions.spec.ts unit_tests/assessments.spec.ts unit_tests/inventory.spec.ts --no-cache` → 83 passed (no regressions).
- **Migration safety:** `1711900000003-ScopeIdempotencyKeys` is additive (new columns + composite unique index + surrogate PK), backfills `actor_id` from the orders table for existing `create_order` rows, and falls back to the all-zeros sentinel for any unmatchable row so legacy keys become unreachable by the new scoped lookup (fail-closed). The migration is reversible via the documented `down()` path.

## Remaining risks (explicit)
- **Idempotency backfill of unmatchable rows:** Any pre-existing `idempotency_keys` row that does not join to an `orders` row gets the all-zeros sentinel `actor_id`. Such rows are intentionally unreachable from the new scoped lookup. This is the safest behaviour but could surface as duplicate-creation if a long-lived legacy key is replayed after the migration. **Mitigation:** the existing 24h cleanup cron in `repo/src/orders/orders.service.ts:277-285` will retire those rows naturally.
- **`platform_admin` without a `storeId`:** their idempotency rows are written with `store_id = NULL`. The `COALESCE(store_id, sentinel)` clause in the new unique index keeps NULLs colliding deterministically, so cross-store key reuse by a single platform_admin still dedupes correctly within their actor scope.
- **Runtime claims:** This pass is static. The new concurrency / cross-tenant API tests are present and exercise the full HTTP stack against the real DB but were not executed in this report's boundary.

## Conclusion
- All seven `audit_report-1` items are resolved in code, tests, and docs with traceable file:line evidence above.
- **No High-severity items remain open.** The previously-identified Blocker (inventory idempotency) and Highs (assessments paper write scope, cross-store coupon application, order idempotency cross-tenant leak) are all closed with both fix code and matching API/unit test coverage.

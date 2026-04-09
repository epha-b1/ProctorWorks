import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scope `idempotency_keys` by (operation_type, actor_id, store_id, key).
 *
 * audit_report-1 §5.4 — the original schema used `key` as the primary
 * key, so a duplicate lookup was global by key. A caller in store B
 * reusing a key already issued in store A would collide on lookup and
 * be served the prior store-A response. That's a cross-tenant data
 * leak with predictable / guessable keys.
 *
 * This migration:
 *   - drops the `key`-only primary key
 *   - adds an `id uuid` surrogate primary key (so existing rows survive)
 *   - adds `actor_id uuid` and `store_id uuid (nullable)` columns
 *   - backfills `actor_id` from the orders table for existing
 *     `create_order` records (best-effort; rows with no matching order
 *     fall back to the all-zeros UUID sentinel and become unreachable
 *     by the new scoped lookup, which is the safest behaviour)
 *   - creates a composite UNIQUE INDEX
 *       (operation_type, actor_id, COALESCE(store_id, sentinel), key)
 *     so NULL store_ids still collide deterministically
 *   - keeps the table backward-safe: any existing column users still
 *     resolve, the only behavioural change is that lookups must now
 *     pass actor + store to find a row.
 */
export class ScopeIdempotencyKeys1711900000003 implements MigrationInterface {
  name = 'ScopeIdempotencyKeys1711900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old key-only PK if it exists.
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP CONSTRAINT IF EXISTS "PK_idempotency_keys"
    `);

    // 2. Add the surrogate id column with a generated default so existing
    //    rows get a stable identifier without a separate UPDATE pass.
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "id" uuid NOT NULL DEFAULT gen_random_uuid()
    `);

    // 3. Add the new scoping columns. `actor_id` is NOT NULL after
    //    backfill; `store_id` is intentionally nullable to support
    //    cross-store / platform-admin operations.
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "actor_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "store_id" uuid
    `);

    // 4. Backfill from orders for the only operation_type the codebase
    //    actually uses today (`create_order`). Anything we can't match
    //    gets the all-zeros sentinel — those rows become unreachable by
    //    the new scoped lookup path, which is the right outcome
    //    (failing closed protects tenant isolation).
    await queryRunner.query(`
      UPDATE "idempotency_keys" ik
      SET
        "actor_id" = COALESCE(o."user_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "store_id" = o."store_id"
      FROM "orders" o
      WHERE ik."key" = o."idempotency_key"
        AND ik."actor_id" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "idempotency_keys"
      SET "actor_id" = '00000000-0000-0000-0000-000000000000'::uuid
      WHERE "actor_id" IS NULL
    `);

    // 5. Now lock actor_id NOT NULL and install the surrogate PK.
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ALTER COLUMN "actor_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id")
    `);

    // 6. Composite UNIQUE INDEX scoped by operation + actor + store + key.
    //    `COALESCE(store_id, sentinel)` is the trick that makes NULL
    //    store_ids participate in uniqueness — without it, two NULL
    //    rows would never collide and the leak would still be
    //    reachable for cross-store operations.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_idempotency_keys_scoped"
      ON "idempotency_keys" (
        "operation_type",
        "actor_id",
        COALESCE("store_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "key"
      )
    `);

    // 7. Helper index for the read path (actor + store + operation
    //    lookup) — strictly redundant with the unique index above but
    //    keeps query plans cheap if any future code only filters by
    //    the prefix.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_idempotency_keys_actor"
      ON "idempotency_keys" ("operation_type", "actor_id", "store_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: drop the scoped indexes / surrogate PK / new columns,
    // restore the legacy key-only PK. Backfilled rows with the sentinel
    // actor_id stay in place but no longer participate in scoping —
    // they will be served by the legacy unscoped lookup again.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_idempotency_keys_actor"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_idempotency_keys_scoped"
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP CONSTRAINT IF EXISTS "PK_idempotency_keys"
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP COLUMN IF EXISTS "store_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP COLUMN IF EXISTS "actor_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP COLUMN IF EXISTS "id"
    `);
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key")
    `);
  }
}

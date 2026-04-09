import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HIGH-1 / audit_report-1 §5.4 — Drop the legacy global UNIQUE constraint
 * on `orders.idempotency_key`.
 *
 * The original schema enforced uniqueness across the whole `orders` table,
 * which directly conflicts with the scoped idempotency design installed by
 * `1711900000003-ScopeIdempotencyKeys`. Under that design two callers in
 * different stores can legitimately reuse the same opaque idempotency
 * key — but the global UNIQUE on `orders.idempotency_key` would still
 * blow up the second insert with a 23505 unique-violation, preventing
 * the cross-tenant happy path from ever working in production.
 *
 * Replace the constraint with a plain BTREE index so the legacy lookup
 * path (debug tooling, ad-hoc queries) still hits an index, but multiple
 * orders can carry the same key. The actual deduplication contract is
 * enforced one level up by the composite unique index on
 * `idempotency_keys (operation_type, actor_id, store_id, key)`.
 *
 * The migration is idempotent: every step is wrapped in IF EXISTS /
 * IF NOT EXISTS so re-running on a partially-migrated database is safe.
 */
export class DropOrdersIdempotencyKeyUnique1711900000004
  implements MigrationInterface
{
  name = 'DropOrdersIdempotencyKeyUnique1711900000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the named UNIQUE constraint that the InitialSchema migration
    //    installed (`UQ_orders_idempotency_key`).
    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP CONSTRAINT IF EXISTS "UQ_orders_idempotency_key"
    `);

    // 2. Belt-and-braces: if any environment ended up with the constraint
    //    under a different (TypeORM auto-generated) name, drop it via the
    //    backing index too. Postgres will refuse to drop an index that
    //    backs a UNIQUE constraint, so this only fires for stray
    //    standalone UNIQUE INDEXes on the column.
    await queryRunner.query(`
      DO $$
      DECLARE
        idx_name text;
      BEGIN
        FOR idx_name IN
          SELECT i.relname
          FROM pg_class t
          JOIN pg_index ix ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          WHERE t.relname = 'orders'
            AND a.attname = 'idempotency_key'
            AND ix.indisunique = true
            AND ix.indrelid NOT IN (
              SELECT conindid FROM pg_constraint WHERE contype = 'u'
            )
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
        END LOOP;
      END $$;
    `);

    // 3. Install a plain (non-unique) BTREE index for the lookup path.
    //    Same column, no uniqueness contract.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_idempotency_key"
      ON "orders" ("idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversing the migration restores the legacy global UNIQUE behavior.
    // This will fail if any cross-tenant duplicate keys exist — that is
    // intentional, because the legacy schema cannot represent them.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_orders_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD CONSTRAINT "UQ_orders_idempotency_key" UNIQUE ("idempotency_key")
    `);
  }
}

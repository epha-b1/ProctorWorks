/**
 * Per-suite reset strategy for API tests.
 *
 * Until now isolation rested entirely on unique identifiers seeded
 * into every fixture (`${Date.now()}` / random suffixes). That
 * prevents collisions within a single run but leaves a growing
 * fixture tail in the DB across runs, which risks hidden inter-test
 * coupling over time (pagination ordering, listing tests where a
 * prior run's rows interleave, etc.).
 *
 * This helper lets a suite register a "label" prefix and then sweep
 * every write-scope row carrying that prefix during `afterAll`.
 *
 * Hard rules:
 *  - audit_logs and idempotency_keys are NEVER deleted. The
 *    append-only contract is a product security invariant and must
 *    not be relaxed even for test cleanup.
 *  - DELETEs are bounded by an explicit LIKE on a single column
 *    per table (name / code / label / sku_code) so the predicate is
 *    indexable and can never sweep rows outside the test scope.
 *  - Cleanup runs are best-effort: a failing DELETE logs a warning
 *    but never fails the test run — the real assertions have
 *    already passed at that point.
 *
 * Usage (inside an API spec):
 *
 *   const RESET_LABEL = `sec_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
 *   // ... inside beforeAll after `mod.get(DataSource)` ...
 *   afterAll(async () => {
 *     await deleteTestArtifacts(ds, RESET_LABEL);
 *     await app.close();
 *   });
 */
import type { DataSource } from 'typeorm';

/**
 * Declaratively: for each table listed here, delete rows where the
 * given column starts with the suite's label prefix. Order matters
 * for foreign-key safety — children first, then parents.
 *
 * This is NOT a generic "delete everything" sweep; only rows whose
 * label column begins with the suite label are candidates.
 */
const LABEL_SCOPED_DELETES: ReadonlyArray<
  { table: string; column: string }
> = [
  { table: 'coupon_claims', column: 'coupon_id' }, // indirect via coupon.code LIKE — swept below
  { table: 'coupons', column: 'code' },
  { table: 'promotions', column: 'name' },
  { table: 'order_items', column: 'order_id' }, // swept via order join below
  { table: 'orders', column: 'idempotency_key' },
  { table: 'inventory_adjustments', column: 'idempotency_key' },
  { table: 'inventory_lots', column: 'lot_code' },
  { table: 'skus', column: 'sku_code' },
  { table: 'products', column: 'name' },
  { table: 'categories', column: 'name' },
  { table: 'brands', column: 'name' },
  { table: 'seat_map_versions', column: 'change_note' },
  { table: 'reservations', column: 'seat_id' }, // swept via seat join below
  { table: 'seats', column: 'label' },
  { table: 'zones', column: 'name' },
  { table: 'rooms', column: 'name' },
  { table: 'stores', column: 'name' },
  { table: 'users', column: 'username' },
];

/**
 * Delete rows whose label column begins with the suite's label
 * prefix. See module docstring for the invariants.
 */
export async function deleteTestArtifacts(
  ds: DataSource,
  labelPrefix: string,
): Promise<void> {
  if (!labelPrefix || labelPrefix.length < 4) {
    // Refuse to sweep with a trivially-short prefix — a prefix like
    // "a" would match real data.
    // eslint-disable-next-line no-console
    console.warn(
      '[api-reset] refusing to sweep with short prefix:',
      labelPrefix,
    );
    return;
  }
  const like = `${labelPrefix}%`;

  // First, cascade-delete coupon_claims for coupons whose code
  // begins with the prefix. Same for order_items + orders, and
  // reservations + seats.
  const cascades: Array<{ sql: string; params: any[] }> = [
    {
      sql: `DELETE FROM coupon_claims WHERE coupon_id IN (SELECT id FROM coupons WHERE code LIKE $1)`,
      params: [like],
    },
    {
      sql: `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key LIKE $1)`,
      params: [like],
    },
    {
      sql: `DELETE FROM reservations WHERE seat_id IN (SELECT id FROM seats WHERE label LIKE $1)`,
      params: [like],
    },
  ];

  for (const { sql, params } of cascades) {
    try {
      await ds.query(sql, params);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[api-reset] cascade skipped:', (err as any)?.message);
    }
  }

  // Direct deletes in FK-safe order.
  for (const { table, column } of LABEL_SCOPED_DELETES) {
    // Skip the tables we just cascaded into; their rows are gone.
    if (
      table === 'coupon_claims' ||
      table === 'order_items' ||
      table === 'reservations'
    ) {
      continue;
    }
    try {
      await ds.query(`DELETE FROM ${table} WHERE ${column} LIKE $1`, [like]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[api-reset] DELETE ${table} skipped:`,
        (err as any)?.message,
      );
    }
  }
}

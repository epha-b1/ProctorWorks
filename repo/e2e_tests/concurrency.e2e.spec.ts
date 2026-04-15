/**
 * Concurrency invariants at the HTTP boundary.
 *
 * The reservation "hold" path has an explicit no-double-hold
 * invariant: for a given seat, at most one *active* (non-expired,
 * non-confirmed, non-cancelled) hold can exist. Under concurrent
 * callers the contract must still hold: exactly one caller wins with
 * 201 and every other concurrent caller sees 409.
 *
 * The idempotent POST /orders path has a sibling invariant: concurrent
 * POSTs with the same (store, actor, key) must resolve to a SINGLE
 * order row, never duplicates. Replays surface as 200 with the same
 * order id; the create itself surfaces as 201.
 */
import { http, bearer, uniq, login, waitForHealth } from './helpers';

jest.setTimeout(90_000);

describe('E2E: concurrency-sensitive flows', () => {
  let adminToken: string;

  beforeAll(async () => {
    await waitForHealth();
    adminToken = await login('admin', 'Admin1234!');
  });

  it('concurrent seat holds: exactly one 201, the rest 409', async () => {
    const room = await http()
      .post('/rooms')
      .set(bearer(adminToken))
      .send({ name: uniq('conc-room') });
    expect(room.status).toBe(201);

    const zone = await http()
      .post(`/rooms/${room.body.id}/zones`)
      .set(bearer(adminToken))
      .send({ name: uniq('conc-zone') });
    expect(zone.status).toBe(201);

    const seat = await http()
      .post(`/zones/${zone.body.id}/seats`)
      .set(bearer(adminToken))
      .send({ label: uniq('conc-seat') });
    expect(seat.status).toBe(201);
    const seatId = seat.body.id;

    const attempts = 6;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        http()
          .post('/reservations')
          .set(bearer(adminToken))
          .send({ seatId }),
      ),
    );

    const statuses = results.map((r) => r.status);
    const wins = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);

    expect(wins.length).toBe(1);
    expect(conflicts.length).toBe(attempts - 1);
    // No request should leak through with any other status.
    expect(wins.length + conflicts.length).toBe(attempts);

    // The single winning reservation is inspectable and still held.
    // The entity enum value is `hold`, exposed verbatim by the
    // service — not `held`.
    const winner = results.find((r) => r.status === 201)!;
    expect(winner.body.seat_id).toBe(seatId);
    expect(winner.body.status).toBe('hold');
    expect(typeof winner.body.hold_until).toBe('string');
  });

  // ──────────────────────────────────────────────────────────────────
  // Race-safety regression — parallel POST /orders with the SAME
  // idempotency key (same scope) must never produce a 500.
  //
  // Prior to the OrdersService race-safety fix, the dedup check +
  // idempotency INSERT was non-atomic: two truly-concurrent callers
  // could both miss the lookup, both enter the transaction, and the
  // loser's idempotency INSERT would raise Postgres SQLSTATE 23505.
  // The global exception filter surfaced that as HTTP 500. The fix
  // catches the unique violation, rolls the loser's transaction back,
  // and resolves via the scoped replay helper — so every concurrent
  // duplicate returns 200/201 pointing at the same order id, and the
  // orders table has exactly ONE row for the key.
  //
  // Black-box, per-task spec: no mocks, no in-process Nest, no
  // massaged error paths — pure parallel HTTP against the live API.
  // ──────────────────────────────────────────────────────────────────
  it('parallel POST /orders same idempotencyKey → no 500, exactly one order', async () => {
    const cat = await http()
      .post('/categories')
      .set(bearer(adminToken))
      .send({ name: uniq('race-cat') });
    const brand = await http()
      .post('/brands')
      .set(bearer(adminToken))
      .send({ name: uniq('race-brand') });
    const prod = await http()
      .post('/products')
      .set(bearer(adminToken))
      .send({
        name: uniq('race-prod'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    const sku = await http()
      .post(`/products/${prod.body.id}/skus`)
      .set(bearer(adminToken))
      .send({ skuCode: uniq('RACE-SKU'), priceCents: 750 });
    expect(sku.status).toBe(201);

    const idem = uniq('race-ord');
    const parallel = 8;

    const results = await Promise.all(
      Array.from({ length: parallel }, () =>
        http()
          .post('/orders')
          .set(bearer(adminToken))
          .send({
            idempotencyKey: idem,
            items: [{ skuId: sku.body.id, quantity: 3 }],
          }),
      ),
    );

    const statuses = results.map((r) => r.status);

    // Primary contract: no server error leaks under the race.
    const fiveHundreds = statuses.filter((s) => s >= 500);
    expect(fiveHundreds).toEqual([]);

    // Every response either created or deduped the same order.
    for (const r of results) {
      expect([200, 201]).toContain(r.status);
      expect(r.body).toHaveProperty('id');
      expect(r.body.total_cents).toBe(2250); // 750 * 3
    }

    // All responses reference a single order id.
    const ids = Array.from(new Set(results.map((r) => r.body.id)));
    expect(ids).toHaveLength(1);
    const orderId = ids[0];

    // At most one 201 (the winner). The loser transactions rolled
    // back cleanly and observed the winner via replay → 200.
    const creates = statuses.filter((s) => s === 201).length;
    const dedups = statuses.filter((s) => s === 200).length;
    expect(creates).toBeLessThanOrEqual(1);
    expect(creates + dedups).toBe(parallel);

    // Single-row invariant: the orders table contains exactly ONE
    // order for that (caller, idempotencyKey) scope.
    const list = await http().get('/orders').set(bearer(adminToken));
    expect(list.status).toBe(200);
    const matching = list.body.filter(
      (o: any) => o.idempotency_key === idem,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(orderId);
  });

  it('serial replays of an idempotent POST /orders never create duplicate orders', async () => {
    // Prep catalog.
    const cat = await http()
      .post('/categories')
      .set(bearer(adminToken))
      .send({ name: uniq('conc-cat') });
    const brand = await http()
      .post('/brands')
      .set(bearer(adminToken))
      .send({ name: uniq('conc-brand') });
    const prod = await http()
      .post('/products')
      .set(bearer(adminToken))
      .send({
        name: uniq('conc-prod'),
        categoryId: cat.body.id,
        brandId: brand.body.id,
      });
    const sku = await http()
      .post(`/products/${prod.body.id}/skus`)
      .set(bearer(adminToken))
      .send({ skuCode: uniq('CONC-SKU'), priceCents: 1500 });
    expect(sku.status).toBe(201);

    // First call is the genuine create; subsequent calls must hit the
    // dedup branch. We run the replays in parallel to exercise the
    // read-back path under concurrent load without racing the
    // idempotency-key insert itself (which is protected by a
    // composite UNIQUE but is not serialisable-safe without a retry
    // loop we deliberately don't assume here — that would be testing
    // implementation detail rather than observable contract).
    const idem = uniq('conc-ord');

    const first = await http()
      .post('/orders')
      .set(bearer(adminToken))
      .send({
        idempotencyKey: idem,
        items: [{ skuId: sku.body.id, quantity: 2 }],
      });
    expect(first.status).toBe(201);
    expect(first.body.total_cents).toBe(3000);
    const orderId = first.body.id;

    const replays = 5;
    const results = await Promise.all(
      Array.from({ length: replays }, () =>
        http()
          .post('/orders')
          .set(bearer(adminToken))
          .send({
            idempotencyKey: idem,
            items: [{ skuId: sku.body.id, quantity: 2 }],
          }),
      ),
    );

    for (const r of results) {
      // All replays MUST hit the dedup branch (strict 200) and
      // return the exact same order id. Anything else means either
      // a duplicate row was created (data corruption) or the dedup
      // lookup silently drifted away from the caller's scope.
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(orderId);
      expect(r.body.total_cents).toBe(3000);
    }

    // State check: listing orders shows exactly one entry for this key.
    const list = await http()
      .get('/orders')
      .set(bearer(adminToken));
    expect(list.status).toBe(200);
    const matching = list.body.filter(
      (o: any) => o.idempotency_key === idem,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(orderId);
  });

  // ──────────────────────────────────────────────────────────────────
  // Seat-hold × maintenance interleaving.
  //
  // A seat transitioning to MAINTENANCE must cascade-cancel any
  // active HOLD reservations atomically (see
  // RoomsService.cancelActiveHoldsForSeat, called from updateSeat's
  // transaction). This test fires N parallel POST /reservations for
  // the seat while simultaneously PATCHing the seat to maintenance
  // status. The contract under arbitrary interleaving is:
  //
  //   - No 5xx from the concurrent paths.
  //   - When the flight is complete the seat is MAINTENANCE.
  //   - No reservation is left in HOLD for that seat — any hold that
  //     won the race must have been cancelled by the cascade or by
  //     the hold path rejecting once the seat flipped.
  //   - Every reservation row the listing surfaces is either
  //     CANCELLED or EXPIRED for that seat.
  //
  // This is the single highest-signal scenario for the interleaving
  // surface and is sufficient to catch the two easily-broken bugs:
  // (a) maintenance flip without cascading holds, (b) create-hold
  // path failing to re-check seat status inside its transaction.
  // ──────────────────────────────────────────────────────────────────
  it('parallel holds + concurrent maintenance flip → no 5xx, no surviving active hold', async () => {
    const room = await http()
      .post('/rooms')
      .set(bearer(adminToken))
      .send({ name: uniq('maint-room') });
    expect(room.status).toBe(201);

    const zone = await http()
      .post(`/rooms/${room.body.id}/zones`)
      .set(bearer(adminToken))
      .send({ name: uniq('maint-zone') });
    expect(zone.status).toBe(201);

    const seat = await http()
      .post(`/zones/${zone.body.id}/seats`)
      .set(bearer(adminToken))
      .send({ label: uniq('maint-seat') });
    expect(seat.status).toBe(201);
    const seatId = seat.body.id;

    // Interleaving: 5 parallel hold attempts + 1 maintenance flip
    // fired in the SAME Promise.all batch. Order of arrival at the
    // service is non-deterministic on purpose — we don't care which
    // wins, only that the final state is consistent.
    const holdCount = 5;
    const calls: Promise<any>[] = [];
    for (let i = 0; i < holdCount; i++) {
      calls.push(
        http()
          .post('/reservations')
          .set(bearer(adminToken))
          .send({ seatId }),
      );
    }
    calls.push(
      http()
        .patch(`/seats/${seatId}`)
        .set(bearer(adminToken))
        .send({ status: 'maintenance' }),
    );

    const results = await Promise.all(calls);

    // Primary contract: no server error leaks under interleaving.
    const fiveHundreds = results.filter((r: any) => r.status >= 500);
    expect(fiveHundreds).toEqual([]);

    // The maintenance PATCH is the last call in the batch and must
    // have surfaced as a 2xx (PATCH defaults to 200 with no
    // @HttpCode on the controller). Every other response is a hold
    // attempt — each must be 201 (won), 400 (seat flipped to
    // maintenance before its transaction), or 409 (another hold
    // already active). Anything else is a bug.
    const maintenanceRes = results[results.length - 1];
    expect([200, 201]).toContain(maintenanceRes.status);
    expect(maintenanceRes.body.status).toBe('maintenance');

    for (let i = 0; i < holdCount; i++) {
      const r = results[i];
      expect([201, 400, 409]).toContain(r.status);
    }

    // Final state invariants via read endpoints:
    // 1. Seat is MAINTENANCE.
    const seats = await http()
      .get(`/zones/${zone.body.id}/seats`)
      .set(bearer(adminToken));
    expect(seats.status).toBe(200);
    const persistedSeat = seats.body.find((s: any) => s.id === seatId);
    expect(persistedSeat).toBeDefined();
    expect(persistedSeat.status).toBe('maintenance');

    // 2. No active HOLD reservation survives for this seat — any
    //    that won the race must be CANCELLED (cascade) or EXPIRED;
    //    never still HOLD.
    const reservations = await http()
      .get(`/reservations?seatId=${seatId}`)
      .set(bearer(adminToken));
    expect(reservations.status).toBe(200);
    for (const r of reservations.body) {
      expect(r.seat_id).toBe(seatId);
      expect(['cancelled', 'expired']).toContain(r.status);
      expect(r.status).not.toBe('hold');
      expect(r.status).not.toBe('confirmed');
    }

    // 3. A fresh hold against the MAINTENANCE seat is rejected,
    //    proving the post-flip rejection path is wired and the seat
    //    did not silently revert.
    const followUp = await http()
      .post('/reservations')
      .set(bearer(adminToken))
      .send({ seatId });
    expect(followUp.status).toBe(400);
    expect(String(followUp.body.message)).toMatch(/maintenance/i);
  });
});

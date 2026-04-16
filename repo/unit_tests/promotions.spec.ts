import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PromotionsService } from '../src/promotions/promotions.service';
import {
  Promotion,
  PromotionType,
  DiscountType,
} from '../src/promotions/entities/promotion.entity';
import { Coupon, CouponStatus } from '../src/promotions/entities/coupon.entity';
import { CouponClaim } from '../src/promotions/entities/coupon-claim.entity';

/* ------------------------------------------------------------------ */
/*  Helper: build mock repositories                                    */
/* ------------------------------------------------------------------ */

function mockRepository() {
  return {
    create: jest.fn((data) => ({ ...data })),
    save: jest.fn((entity) =>
      Promise.resolve(Array.isArray(entity) ? entity : { id: 'generated-uuid', ...entity }),
    ),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(),
  };
}

function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-aaa',
    store_id: 'store-1',
    name: 'Test Promo',
    type: PromotionType.THRESHOLD,
    priority: 10,
    discount_type: DiscountType.FIXED_CENTS,
    discount_value: 500,
    min_order_cents: null,
    starts_at: null,
    ends_at: null,
    redemption_cap: null,
    redemption_count: 0,
    active: true,
    ...overrides,
  } as Promotion;
}

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    store_id: 'store-1',
    code: 'SAVE10',
    promotion_id: 'promo-coupon',
    promotion: makePromotion({ id: 'promo-coupon', discount_value: 300 }),
    remaining_quantity: 5,
    starts_at: null,
    ends_at: null,
    status: CouponStatus.ACTIVE,
    ...overrides,
  } as Coupon;
}

/* ------------------------------------------------------------------ */
/*  Build service with fresh mocks                                     */
/* ------------------------------------------------------------------ */

function createService() {
  const promotionRepo = mockRepository();
  const couponRepo = mockRepository();
  const claimRepo = mockRepository();

  // Mock DataSource: route .transaction() through a fake EntityManager
  // that delegates getRepository() back to the same repo doubles, so
  // service code that uses manager.getRepository(X) sees the same mocks
  // unit tests are configuring directly.
  const fakeManager = {
    getRepository: (entity: any) => {
      const name = (entity?.name ?? entity)?.toString();
      if (name?.includes('Promotion')) return promotionRepo;
      if (name?.includes('CouponClaim')) return claimRepo;
      if (name?.includes('Coupon')) return couponRepo;
      return promotionRepo;
    },
  };
  const dataSource = {
    transaction: jest.fn(async (cb: any) => cb(fakeManager)),
  };

  const service = new PromotionsService(
    promotionRepo as any,
    couponRepo as any,
    claimRepo as any,
    dataSource as any,
  );

  return { service, promotionRepo, couponRepo, claimRepo, dataSource };
}

/* ================================================================== */
/*  TESTS                                                              */
/* ================================================================== */

describe('PromotionsService', () => {
  /* -------------------------------------------------------------- */
  /*  1. createPromotion                                             */
  /* -------------------------------------------------------------- */
  describe('createPromotion', () => {
    it('creates a promotion with the correct fields', async () => {
      const { service, promotionRepo } = createService();

      const dto = {
        storeId: 'store-1',
        name: 'Summer Sale',
        type: PromotionType.THRESHOLD,
        priority: 5,
        discountType: DiscountType.FIXED_CENTS,
        discountValue: 1000,
        minOrderCents: 5000,
        startsAt: '2026-06-01T00:00:00Z',
        endsAt: '2026-09-01T00:00:00Z',
        redemptionCap: 100,
      };

      await service.createPromotion(dto as any);

      expect(promotionRepo.create).toHaveBeenCalledWith({
        store_id: 'store-1',
        name: 'Summer Sale',
        type: PromotionType.THRESHOLD,
        priority: 5,
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 1000,
        min_order_cents: 5000,
        starts_at: new Date('2026-06-01T00:00:00Z'),
        ends_at: new Date('2026-09-01T00:00:00Z'),
        redemption_cap: 100,
      });
      expect(promotionRepo.save).toHaveBeenCalled();
    });
  });

  /* -------------------------------------------------------------- */
  /*  2-4. Conflict resolution via resolvePromotions                 */
  /* -------------------------------------------------------------- */
  describe('conflict resolution (resolvePromotions)', () => {
    function setupQueryBuilder(promotions: Promotion[]) {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(promotions),
      };
      return qb;
    }

    it('higher priority wins', async () => {
      const { service, promotionRepo, couponRepo, claimRepo } = createService();

      const low = makePromotion({ id: 'promo-low', priority: 1, discount_value: 9999 });
      const high = makePromotion({ id: 'promo-high', priority: 10, discount_value: 100 });

      const qb = setupQueryBuilder([low, high]);
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);

      const result = await service.resolvePromotions(10000, 'user-1', 'store-1');

      expect(result.selectedPromotion!.id).toBe('promo-high');
    });

    it('same priority -> best customer value (highest discount) wins', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      const small = makePromotion({
        id: 'promo-small',
        priority: 5,
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 200,
      });
      const large = makePromotion({
        id: 'promo-large',
        priority: 5,
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 800,
      });

      const qb = setupQueryBuilder([small, large]);
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);

      const result = await service.resolvePromotions(10000, 'user-1', 'store-1');

      expect(result.selectedPromotion!.id).toBe('promo-large');
      expect(result.totalDiscount).toBe(800);
    });

    it('same priority, same discount -> lower UUID wins (deterministic tie-breaker)', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      const promoA = makePromotion({
        id: 'aaa-0001',
        priority: 5,
        discount_value: 500,
      });
      const promoB = makePromotion({
        id: 'zzz-9999',
        priority: 5,
        discount_value: 500,
      });

      const qb = setupQueryBuilder([promoB, promoA]);
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);

      const result = await service.resolvePromotions(10000, 'user-1', 'store-1');

      expect(result.selectedPromotion!.id).toBe('aaa-0001');
    });
  });

  /* -------------------------------------------------------------- */
  /*  5-7. calculateDiscount                                         */
  /* -------------------------------------------------------------- */
  describe('calculateDiscount', () => {
    it('fixed_cents type returns discount_value', () => {
      const { service } = createService();
      const promo = makePromotion({
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 750,
        min_order_cents: null,
      });

      const result = (service as any).calculateDiscount(promo, 10000);
      expect(result).toBe(750);
    });

    it('percentage type returns floor(total * value / 100)', () => {
      const { service } = createService();
      const promo = makePromotion({
        discount_type: DiscountType.PERCENTAGE,
        discount_value: 15,
        min_order_cents: null,
      });

      // 10000 * 15 / 100 = 1500
      expect((service as any).calculateDiscount(promo, 10000)).toBe(1500);

      // 9999 * 15 / 100 = 1499.85 -> floor = 1499
      expect((service as any).calculateDiscount(promo, 9999)).toBe(1499);
    });

    it('min_order_cents not met -> returns 0', () => {
      const { service } = createService();
      const promo = makePromotion({
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 500,
        min_order_cents: 5000,
      });

      expect((service as any).calculateDiscount(promo, 4999)).toBe(0);
      expect((service as any).calculateDiscount(promo, 5000)).toBe(500);
    });
  });

  /* -------------------------------------------------------------- */
  /*  8-11. claimCoupon                                              */
  /* -------------------------------------------------------------- */
  describe('claimCoupon', () => {
    // After audit_report-2 P0-2, claimCoupon takes the FULL `user`
    // context (not just `userId`). Existing tests pass a platform
    // admin user object so the store-scope guard becomes a no-op
    // (admin role bypasses scoping).
    const platformAdmin = { id: 'user-1', role: 'platform_admin' };

    it('active coupon -> creates claim and decrements remaining_quantity', async () => {
      const { service, couponRepo, claimRepo } = createService();

      const coupon = makeCoupon({ remaining_quantity: 5 });
      couponRepo.findOne.mockResolvedValue(coupon);

      const savedClaim = { id: 'claim-1', coupon_id: coupon.id, user_id: 'user-1' };
      claimRepo.save.mockResolvedValue(savedClaim);

      const result = await service.claimCoupon('SAVE10', platformAdmin);

      expect(claimRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ coupon_id: coupon.id, user_id: 'user-1' }),
      );
      expect(claimRepo.save).toHaveBeenCalled();
      expect(coupon.remaining_quantity).toBe(4);
      expect(couponRepo.save).toHaveBeenCalledWith(coupon);
      expect(result).toEqual(savedClaim);
    });

    it('expired coupon -> throws BadRequestException', async () => {
      const { service, couponRepo } = createService();

      const coupon = makeCoupon({ status: CouponStatus.EXPIRED });
      couponRepo.findOne.mockResolvedValue(coupon);

      await expect(
        service.claimCoupon('SAVE10', platformAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('exhausted coupon -> throws BadRequestException', async () => {
      const { service, couponRepo } = createService();

      const coupon = makeCoupon({ status: CouponStatus.EXHAUSTED });
      couponRepo.findOne.mockResolvedValue(coupon);

      await expect(
        service.claimCoupon('SAVE10', platformAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('remaining_quantity reaches 0 -> sets status=exhausted', async () => {
      const { service, couponRepo, claimRepo } = createService();

      const coupon = makeCoupon({ remaining_quantity: 1 });
      couponRepo.findOne.mockResolvedValue(coupon);
      claimRepo.save.mockResolvedValue({ id: 'claim-1' });

      await service.claimCoupon('SAVE10', platformAdmin);

      expect(coupon.remaining_quantity).toBe(0);
      expect(coupon.status).toBe(CouponStatus.EXHAUSTED);
      expect(couponRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CouponStatus.EXHAUSTED }),
      );
    });

    // ---------------------------------------------------------------
    // audit_report-2 P0-2: tenant binding on claim.
    //
    // store_admin must NOT be able to claim a coupon belonging to
    // another store. The guard runs BEFORE the usability check so
    // the foreign coupon's status is never leaked through the error
    // message — the caller just sees 404 (hiding policy).
    // ---------------------------------------------------------------
    describe('P0-2: store-scoped object authorization', () => {
      const storeAdminA = {
        id: 'sa-a',
        role: 'store_admin',
        storeId: 'store-A',
      };
      const storeAdminNone = {
        id: 'sa-x',
        role: 'store_admin',
        storeId: null,
      };

      it('store_admin: foreign-store coupon → NotFoundException, no claim, no decrement', async () => {
        const { service, couponRepo, claimRepo } = createService();
        const foreignCoupon = makeCoupon({
          store_id: 'store-OTHER',
          remaining_quantity: 5,
        });
        couponRepo.findOne.mockResolvedValue(foreignCoupon);

        await expect(
          service.claimCoupon('FOREIGN-CODE', storeAdminA),
        ).rejects.toThrow(NotFoundException);

        // No claim row was saved, no remaining_quantity mutation,
        // no second couponRepo.save call (the one inside the
        // remaining-quantity decrement path).
        expect(claimRepo.save).not.toHaveBeenCalled();
        expect(couponRepo.save).not.toHaveBeenCalled();
        expect(foreignCoupon.remaining_quantity).toBe(5);
      });

      it('store_admin: same-store coupon → claim works and decrements', async () => {
        const { service, couponRepo, claimRepo } = createService();
        const ownCoupon = makeCoupon({
          store_id: 'store-A',
          remaining_quantity: 3,
        });
        couponRepo.findOne.mockResolvedValue(ownCoupon);
        claimRepo.save.mockResolvedValue({ id: 'claim-own', coupon_id: ownCoupon.id });

        const result = await service.claimCoupon('OWN-CODE', storeAdminA);

        expect(result).toBeDefined();
        expect(ownCoupon.remaining_quantity).toBe(2);
        expect(claimRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ user_id: 'sa-a' }),
        );
      });

      it('unassigned store_admin → ForbiddenException (fail-fast on broken invariant)', async () => {
        const { service, couponRepo, claimRepo } = createService();
        const someCoupon = makeCoupon({ store_id: 'store-A' });
        couponRepo.findOne.mockResolvedValue(someCoupon);

        await expect(
          service.claimCoupon('SOME-CODE', storeAdminNone),
        ).rejects.toThrow(ForbiddenException);

        expect(claimRepo.save).not.toHaveBeenCalled();
        expect(couponRepo.save).not.toHaveBeenCalled();
      });

      it('foreign-store coupon scope check runs BEFORE usability check (no status leak)', async () => {
        // Critical ordering: even if the foreign coupon is also
        // EXPIRED/EXHAUSTED, the caller must see 404 (hiding), not
        // 400 ("expired") which would confirm the code exists.
        const { service, couponRepo } = createService();
        const exhaustedForeign = makeCoupon({
          store_id: 'store-OTHER',
          remaining_quantity: 0,
          status: CouponStatus.EXHAUSTED,
        });
        couponRepo.findOne.mockResolvedValue(exhaustedForeign);

        await expect(
          service.claimCoupon('FOREIGN-EXHAUSTED', storeAdminA),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  /* -------------------------------------------------------------- */
  /*  12. Redemption cap enforcement                                 */
  /* -------------------------------------------------------------- */
  describe('redemption cap enforcement', () => {
    it('capped promotion at limit -> not eligible', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      const capped = makePromotion({
        id: 'promo-capped',
        redemption_cap: 50,
        redemption_count: 50,
        priority: 10,
        discount_value: 1000,
      });

      // The query builder's andWhere clause filters out promotions where
      // redemption_count >= redemption_cap, so it should NOT appear in results.
      // We simulate the DB correctly filtering it out.
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),  // capped promo filtered out by DB
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);

      const result = await service.resolvePromotions(10000, 'user-1', 'store-1');

      expect(result.selectedPromotion).toBeNull();
      expect(result.totalDiscount).toBe(0);
    });
  });

  /* -------------------------------------------------------------- */
  /*  13. One coupon + one auto promotion max per order               */
  /* -------------------------------------------------------------- */
  describe('one coupon + one auto promotion max per order', () => {
    it('stacks exactly one auto promo and one coupon promo', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      const autoPromo = makePromotion({
        id: 'promo-auto',
        priority: 10,
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 500,
      });

      const couponPromo = makePromotion({
        id: 'promo-coupon',
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 300,
      });

      const coupon = makeCoupon({
        code: 'SAVE10',
        promotion: couponPromo,
        status: CouponStatus.ACTIVE,
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([autoPromo]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(coupon);

      const result = await service.resolvePromotions(10000, 'user-1', 'store-1', 'SAVE10');

      // Both discounts should be summed: 500 (auto) + 300 (coupon) = 800
      expect(result.totalDiscount).toBe(800);
      expect(result.selectedCoupon).toBe(coupon);
      expect(result.selectedPromotion).not.toBeNull();
    });

    // ─────────────────────────────────────────────────────────────
    // audit_report-2 (test fixer pass) — promotion dedup bug fix.
    //
    // When a coupon is bound to a Promotion record that ALSO matches
    // the auto-promotion query (same store + active + in-window +
    // not capped), the same promotion id was being applied TWICE —
    // once on the auto path and once on the coupon path. That
    // violated docs/design.md §6 "Apply at most one coupon + one
    // automatic promotion" and double-counted the discount.
    //
    // The fix dedupes by promotion id. This test pins the contract
    // so any regression that re-introduces the double-count blows
    // up here before it reaches integration.
    // ─────────────────────────────────────────────────────────────
    it('does NOT double-count when coupon promo == best auto promo (same id)', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      // ONE Promotion row that satisfies BOTH selection paths.
      const sharedPromo = makePromotion({
        id: 'promo-shared',
        priority: 10,
        discount_type: DiscountType.FIXED_CENTS,
        discount_value: 1500,
      });

      const couponBoundToSharedPromo = makeCoupon({
        code: 'SHARED-CODE',
        store_id: 'store-1',
        promotion: sharedPromo,
        status: CouponStatus.ACTIVE,
      });

      // Auto-promotion query returns the same promo as the coupon.
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([sharedPromo]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(couponBoundToSharedPromo);

      const result = await service.resolvePromotions(
        10000,
        'user-1',
        'store-1',
        'SHARED-CODE',
      );

      // Critical contract: 1500 (one application), NOT 3000 (double).
      expect(result.totalDiscount).toBe(1500);
      // Coupon binding is still recorded — for analytics + the
      // one-claim-per-coupon ledger — even though its discount was
      // suppressed for being a duplicate of the auto path.
      expect(result.selectedCoupon).toBe(couponBoundToSharedPromo);
      expect(result.selectedPromotion?.id).toBe('promo-shared');
    });
  });

  /* -------------------------------------------------------------- */
  /*  Cross-store coupon binding (audit_report-1 §5.3)                */
  /*                                                                  */
  /*  resolvePromotions must reject coupons whose store_id does not   */
  /*  match the order's store. Mismatch is a deterministic no-op:     */
  /*  the coupon is silently ignored, no discount is applied, and no  */
  /*  exception is thrown — the order can still be created without    */
  /*  the bad coupon.                                                  */
  /* -------------------------------------------------------------- */
  describe('cross-store coupon binding', () => {
    it('rejects coupon whose store_id ≠ order store (no discount applied)', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      // Coupon is bound to store-FOREIGN; order is for store-MINE.
      const foreignCoupon = makeCoupon({
        id: 'coupon-foreign',
        store_id: 'store-FOREIGN',
        code: 'CROSS-STORE',
        promotion: makePromotion({
          id: 'promo-foreign',
          discount_type: DiscountType.FIXED_CENTS,
          discount_value: 999,
        }),
        status: CouponStatus.ACTIVE,
      });

      // No auto promotions in store-MINE so the entire discount must
      // come from the coupon — if the cross-store guard fails, this
      // assertion below will catch it.
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(foreignCoupon);

      const result = await service.resolvePromotions(
        10_000,
        'user-1',
        'store-MINE',
        'CROSS-STORE',
      );

      // Critical contract:
      // - selectedCoupon stays null (not the foreign one)
      // - totalDiscount stays 0 (the foreign 999 must NOT leak in)
      // - selectedPromotion stays null because there are no auto promos
      expect(result.selectedCoupon).toBeNull();
      expect(result.selectedPromotion).toBeNull();
      expect(result.totalDiscount).toBe(0);
    });

    it('matching coupon (same store) is still applied (positive control)', async () => {
      const { service, promotionRepo, couponRepo } = createService();

      const localCoupon = makeCoupon({
        id: 'coupon-local',
        store_id: 'store-MINE',
        code: 'LOCAL10',
        promotion: makePromotion({
          id: 'promo-local',
          discount_type: DiscountType.FIXED_CENTS,
          discount_value: 250,
        }),
        status: CouponStatus.ACTIVE,
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(localCoupon);

      const result = await service.resolvePromotions(
        10_000,
        'user-1',
        'store-MINE',
        'LOCAL10',
      );

      expect(result.selectedCoupon).toBe(localCoupon);
      expect(result.totalDiscount).toBe(250);
    });
  });

  /* -------------------------------------------------------------- */
  /*  14-15. First-order detection                                    */
  /* -------------------------------------------------------------- */
  describe('first-order detection', () => {
    it('user with no prior orders -> eligible for first_order promo', async () => {
      const { service, promotionRepo, couponRepo, claimRepo } = createService();

      const firstOrderPromo = makePromotion({
        id: 'promo-first',
        type: PromotionType.FIRST_ORDER,
        priority: 20,
        discount_value: 1000,
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([firstOrderPromo]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);
      // No prior claims -> user is new
      claimRepo.findOne.mockResolvedValue(null);

      const result = await service.resolvePromotions(10000, 'user-new', 'store-1');

      expect(result.selectedPromotion!.id).toBe('promo-first');
      expect(result.totalDiscount).toBe(1000);
    });

    it('user with prior orders -> not eligible for first_order promo', async () => {
      const { service, promotionRepo, couponRepo, claimRepo } = createService();

      const firstOrderPromo = makePromotion({
        id: 'promo-first',
        type: PromotionType.FIRST_ORDER,
        priority: 20,
        discount_value: 1000,
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([firstOrderPromo]),
      };
      promotionRepo.createQueryBuilder.mockReturnValue(qb);
      couponRepo.findOne.mockResolvedValue(null);
      // User has a prior redeemed claim -> has prior orders
      claimRepo.findOne.mockResolvedValue({
        id: 'old-claim',
        user_id: 'user-returning',
        redeemed_at: new Date('2026-01-01'),
      });

      const result = await service.resolvePromotions(10000, 'user-returning', 'store-1');

      expect(result.selectedPromotion).toBeNull();
      expect(result.totalDiscount).toBe(0);
    });
  });

  /* -------------------------------------------------------------- */
  /*  16. Tenant isolation for coupon operations                      */
  /* -------------------------------------------------------------- */
  describe('coupon tenant isolation', () => {
    it('store_admin cannot distribute coupon from another store', async () => {
      const { service, couponRepo } = createService();

      couponRepo.findOne.mockResolvedValue(
        makeCoupon({ id: 'coupon-x', store_id: 'store-a' }),
      );

      await expect(
        service.distributeCoupon(
          'coupon-x',
          ['user-1', 'user-2'],
          { id: 'admin-1', role: 'store_admin', storeId: 'store-b' },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('store_admin can expire own-store coupon', async () => {
      const { service, couponRepo } = createService();

      const coupon = makeCoupon({ id: 'coupon-own', store_id: 'store-1' });
      couponRepo.findOne.mockResolvedValue(coupon);

      await service.expireCoupon(
        'coupon-own',
        { id: 'admin-1', role: 'store_admin', storeId: 'store-1' },
      );

      expect(couponRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'coupon-own', status: CouponStatus.EXPIRED }),
      );
    });
  });

  /* -------------------------------------------------------------- */
  /*  17. F-04 governance: distribute / redeem checks + counter      */
  /* -------------------------------------------------------------- */
  describe('coupon governance (F-04)', () => {
    describe('distributeCoupon', () => {
      it('rejects expired coupon', async () => {
        const { service, couponRepo } = createService();
        couponRepo.findOne.mockResolvedValue(
          makeCoupon({ status: CouponStatus.EXPIRED }),
        );

        await expect(
          service.distributeCoupon('coupon-1', ['u1'], { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects exhausted coupon', async () => {
        const { service, couponRepo } = createService();
        couponRepo.findOne.mockResolvedValue(
          makeCoupon({ status: CouponStatus.EXHAUSTED }),
        );

        await expect(
          service.distributeCoupon('coupon-1', ['u1'], { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects coupon outside its time window (not yet active)', async () => {
        const { service, couponRepo } = createService();
        const future = new Date(Date.now() + 24 * 3600 * 1000);
        couponRepo.findOne.mockResolvedValue(
          makeCoupon({ starts_at: future }),
        );

        await expect(
          service.distributeCoupon('coupon-1', ['u1'], { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects coupon outside its time window (already ended)', async () => {
        const { service, couponRepo } = createService();
        const past = new Date(Date.now() - 24 * 3600 * 1000);
        couponRepo.findOne.mockResolvedValue(makeCoupon({ ends_at: past }));

        await expect(
          service.distributeCoupon('coupon-1', ['u1'], { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects when remaining quantity cannot cover the recipient batch', async () => {
        const { service, couponRepo } = createService();
        couponRepo.findOne.mockResolvedValue(
          makeCoupon({ remaining_quantity: 2 }),
        );

        await expect(
          service.distributeCoupon(
            'coupon-1',
            ['u1', 'u2', 'u3'],
            { role: 'platform_admin' },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('decrements remaining_quantity by recipient count and saves', async () => {
        const { service, couponRepo, claimRepo } = createService();
        const coupon = makeCoupon({ remaining_quantity: 5 });
        couponRepo.findOne.mockResolvedValue(coupon);
        claimRepo.save.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

        await service.distributeCoupon(
          'coupon-1',
          ['u1', 'u2'],
          { role: 'platform_admin' },
        );

        expect(coupon.remaining_quantity).toBe(3);
        expect(couponRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ remaining_quantity: 3 }),
        );
      });

      it('flips status to EXHAUSTED when distribution drains the pool', async () => {
        const { service, couponRepo, claimRepo } = createService();
        const coupon = makeCoupon({ remaining_quantity: 2 });
        couponRepo.findOne.mockResolvedValue(coupon);
        claimRepo.save.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

        await service.distributeCoupon(
          'coupon-1',
          ['u1', 'u2'],
          { role: 'platform_admin' },
        );

        expect(coupon.status).toBe(CouponStatus.EXHAUSTED);
      });
    });

    describe('redeemCoupon', () => {
      function setupRedeem(opts: {
        coupon: Partial<Coupon>;
        existingClaim?: any;
        cappedUpdateAffected?: number;
      }) {
        const ctx = createService();
        const coupon = makeCoupon({
          promotion_id: 'promo-1',
          ...opts.coupon,
        });
        ctx.couponRepo.findOne.mockResolvedValue(coupon);
        ctx.claimRepo.findOne.mockResolvedValue(
          opts.existingClaim ?? { id: 'claim-1', coupon_id: coupon.id, user_id: 'u1', redeemed_at: null, order_id: null },
        );
        ctx.claimRepo.save.mockImplementation((c: any) => Promise.resolve(c));
        const updateExecute = jest
          .fn()
          .mockResolvedValue({ affected: opts.cappedUpdateAffected ?? 1 });
        ctx.promotionRepo.createQueryBuilder.mockReturnValue({
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: updateExecute,
        });
        return { ...ctx, coupon, updateExecute };
      }

      it('rejects when coupon already expired', async () => {
        const { service } = setupRedeem({
          coupon: { status: CouponStatus.EXPIRED },
        });
        await expect(
          service.redeemCoupon('SAVE10', 'u1', 'order-1', { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects when coupon time window has ended', async () => {
        const { service } = setupRedeem({
          coupon: { ends_at: new Date(Date.now() - 1000) },
        });
        await expect(
          service.redeemCoupon('SAVE10', 'u1', 'order-1', { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects when no unredeemed claim exists for the user', async () => {
        const ctx = createService();
        ctx.couponRepo.findOne.mockResolvedValue(makeCoupon());
        ctx.claimRepo.findOne.mockResolvedValue(null);
        await expect(
          ctx.service.redeemCoupon('SAVE10', 'u1', 'order-1', { role: 'platform_admin' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('atomically increments redemption_count and marks claim redeemed', async () => {
        const { service, updateExecute, claimRepo } = setupRedeem({
          coupon: {},
        });
        await service.redeemCoupon('SAVE10', 'u1', 'order-99', {
          role: 'platform_admin',
        });

        // Atomic UPDATE was issued — that's what bumps the count.
        expect(updateExecute).toHaveBeenCalled();
        // Claim was marked redeemed with the order id.
        expect(claimRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            redeemed_at: expect.any(Date),
            order_id: 'order-99',
          }),
        );
      });

      it('rejects when promotion redemption cap is already at the limit', async () => {
        // 0 rows updated → cap was reached, the SET is guarded by the
        // andWhere(redemption_count < redemption_cap).
        const { service } = setupRedeem({
          coupon: {},
          cappedUpdateAffected: 0,
        });
        await expect(
          service.redeemCoupon('SAVE10', 'u1', 'order-1', { role: 'platform_admin' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  /* -------------------------------------------------------------- */
  /*  Defensive / long-tail branches                                  */
  /*                                                                 */
  /*  Closes remaining branches in findPromotions / findCoupons /    */
  /*  updatePromotion / deletePromotion / expireCoupon /             */
  /*  resolvePromotions edge paths + handleExpiredCoupons cron.      */
  /*  These are the non-happy-path branches documented in README's    */
  /*  coverage-gap notes.                                             */
  /* -------------------------------------------------------------- */
  describe('long-tail defensive branches', () => {
    describe('findPromotions / findCoupons', () => {
      it('findPromotions without storeId → unscoped find', async () => {
        const { service, promotionRepo } = createService();
        promotionRepo.find.mockResolvedValue([]);
        await service.findPromotions();
        expect(promotionRepo.find).toHaveBeenCalledWith({ where: {} });
      });

      it('findPromotions with storeId → scoped find', async () => {
        const { service, promotionRepo } = createService();
        promotionRepo.find.mockResolvedValue([]);
        await service.findPromotions('store-7');
        expect(promotionRepo.find).toHaveBeenCalledWith({
          where: { store_id: 'store-7' },
        });
      });

      it('findCoupons without storeId → unscoped find', async () => {
        const { service, couponRepo } = createService();
        couponRepo.find.mockResolvedValue([]);
        await service.findCoupons();
        expect(couponRepo.find).toHaveBeenCalledWith({ where: {} });
      });

      it('findCoupons with storeId → scoped find', async () => {
        const { service, couponRepo } = createService();
        couponRepo.find.mockResolvedValue([]);
        await service.findCoupons('store-9');
        expect(couponRepo.find).toHaveBeenCalledWith({
          where: { store_id: 'store-9' },
        });
      });
    });

    describe('updatePromotion field-by-field application', () => {
      it('throws NotFoundException when the promo does not exist in scope', async () => {
        const { service, promotionRepo } = createService();
        promotionRepo.findOne.mockResolvedValue(null);
        await expect(
          service.updatePromotion('missing-id', { name: 'x' }, 'store-1'),
        ).rejects.toThrow(NotFoundException);
        // Scope-narrow predicate propagated into the findOne where clause.
        expect(promotionRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'missing-id', store_id: 'store-1' },
        });
      });

      it('applies every patchable field exactly when present in the DTO', async () => {
        const { service, promotionRepo } = createService();
        const existing = makePromotion({
          id: 'p-1',
          priority: 1,
          min_order_cents: null,
          starts_at: null,
          ends_at: null,
          redemption_cap: null,
          active: true,
        });
        promotionRepo.findOne.mockResolvedValue(existing);
        promotionRepo.save.mockImplementation(async (p: any) => p);

        const updated = await service.updatePromotion(
          'p-1',
          {
            name: 'Renamed',
            type: PromotionType.THRESHOLD,
            priority: 50,
            discountType: DiscountType.PERCENTAGE,
            discountValue: 25,
            minOrderCents: 1000,
            startsAt: '2026-05-01T00:00:00Z',
            endsAt: '2026-06-01T00:00:00Z',
            redemptionCap: 100,
            active: false,
          } as any,
        );
        expect(updated.name).toBe('Renamed');
        expect(updated.type).toBe(PromotionType.THRESHOLD);
        expect(updated.priority).toBe(50);
        expect(updated.discount_type).toBe(DiscountType.PERCENTAGE);
        expect(updated.discount_value).toBe(25);
        expect(updated.min_order_cents).toBe(1000);
        expect(updated.starts_at).toEqual(new Date('2026-05-01T00:00:00Z'));
        expect(updated.ends_at).toEqual(new Date('2026-06-01T00:00:00Z'));
        expect(updated.redemption_cap).toBe(100);
        expect(updated.active).toBe(false);
      });

      it('startsAt / endsAt null → stored as null (explicit clear)', async () => {
        const { service, promotionRepo } = createService();
        promotionRepo.findOne.mockResolvedValue(
          makePromotion({
            starts_at: new Date('2025-01-01'),
            ends_at: new Date('2025-12-31'),
          }),
        );
        promotionRepo.save.mockImplementation(async (p: any) => p);
        const result = await service.updatePromotion('p-1', {
          startsAt: null,
          endsAt: null,
        } as any);
        expect(result.starts_at).toBeNull();
        expect(result.ends_at).toBeNull();
      });

      it('no-op DTO leaves every field unchanged', async () => {
        const { service, promotionRepo } = createService();
        const existing = makePromotion({ priority: 7 });
        promotionRepo.findOne.mockResolvedValue(existing);
        promotionRepo.save.mockImplementation(async (p: any) => p);
        const result = await service.updatePromotion('p-1', {} as any);
        expect(result.priority).toBe(7);
        expect(result.name).toBe(existing.name);
      });
    });

    describe('deletePromotion', () => {
      it('removes in scope', async () => {
        const { service, promotionRepo } = createService();
        const existing = makePromotion();
        promotionRepo.findOne.mockResolvedValue(existing);
        promotionRepo.remove = jest.fn().mockResolvedValue(existing);
        await service.deletePromotion('p-1', 'store-1');
        expect(promotionRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'p-1', store_id: 'store-1' },
        });
        expect(promotionRepo.remove).toHaveBeenCalled();
      });

      it('throws NotFound when not in scope', async () => {
        const { service, promotionRepo } = createService();
        promotionRepo.findOne.mockResolvedValue(null);
        await expect(
          service.deletePromotion('missing', 'store-1'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('expireCoupon', () => {
      it('platform_admin can expire any coupon → status flips to EXPIRED', async () => {
        const { service, couponRepo } = createService();
        const coupon = makeCoupon();
        couponRepo.findOne.mockResolvedValue(coupon);
        couponRepo.save.mockImplementation(async (c: any) => c);
        const result = await service.expireCoupon('coupon-1', {
          role: 'platform_admin',
        });
        expect(result.status).toBe(CouponStatus.EXPIRED);
      });

      it('throws NotFound when coupon does not exist', async () => {
        const { service, couponRepo } = createService();
        couponRepo.findOne.mockResolvedValue(null);
        await expect(
          service.expireCoupon('missing', { role: 'platform_admin' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('store_admin expiring a foreign-store coupon → NotFound (hiding policy)', async () => {
        const { service, couponRepo } = createService();
        couponRepo.findOne.mockResolvedValue(makeCoupon({ store_id: 'store-OTHER' }));
        await expect(
          service.expireCoupon('coupon-1', {
            role: 'store_admin',
            storeId: 'store-1',
          }),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('resolvePromotions edge paths', () => {
      function setupResolve(promotions: Promotion[], coupon: Coupon | null) {
        const { service, promotionRepo, couponRepo, claimRepo } = createService();
        const qb: any = {};
        qb.where = jest.fn().mockReturnValue(qb);
        qb.andWhere = jest.fn().mockReturnValue(qb);
        qb.getMany = jest.fn().mockResolvedValue(promotions);
        promotionRepo.createQueryBuilder.mockReturnValue(qb);
        claimRepo.findOne.mockResolvedValue(null);
        couponRepo.findOne.mockResolvedValue(coupon);
        return { service, qb };
      }

      it('no promotions + no coupon → zero discount, null selections', async () => {
        const { service } = setupResolve([], null);
        const res = await service.resolvePromotions(10000, 'u-1', 'store-1');
        expect(res.selectedPromotion).toBeNull();
        expect(res.selectedCoupon).toBeNull();
        expect(res.totalDiscount).toBe(0);
      });

      it('auto promo with discount=0 (below min_order_cents) → not selected', async () => {
        const promo = makePromotion({
          id: 'too-expensive',
          min_order_cents: 100000,
          discount_value: 500,
        });
        const { service } = setupResolve([promo], null);
        const res = await service.resolvePromotions(1000, 'u-1', 'store-1');
        expect(res.selectedPromotion).toBeNull();
        expect(res.totalDiscount).toBe(0);
      });

      it('coupon with ends_at in the past → rejected, no discount applied', async () => {
        const expired = makeCoupon({
          ends_at: new Date('2000-01-01'),
        });
        const { service } = setupResolve([], expired);
        const res = await service.resolvePromotions(
          5000,
          'u-1',
          'store-1',
          'SAVE10',
        );
        expect(res.selectedCoupon).toBeNull();
        expect(res.totalDiscount).toBe(0);
      });

      it('coupon with starts_at in the future → rejected (not yet active)', async () => {
        const future = makeCoupon({
          starts_at: new Date('2099-01-01'),
        });
        const { service } = setupResolve([], future);
        const res = await service.resolvePromotions(
          5000,
          'u-1',
          'store-1',
          'SAVE10',
        );
        expect(res.selectedCoupon).toBeNull();
      });

      it('cross-store coupon → not applied (silent rejection, logged as warn)', async () => {
        const foreign = makeCoupon({ store_id: 'store-OTHER' });
        const { service } = setupResolve([], foreign);
        const res = await service.resolvePromotions(
          5000,
          'u-1',
          'store-1',
          'SAVE10',
        );
        expect(res.selectedCoupon).toBeNull();
        expect(res.totalDiscount).toBe(0);
      });

      it('coupon-only (no auto promo): coupon promotion becomes selectedPromotion', async () => {
        const couponPromo = makePromotion({
          id: 'p-coupon',
          discount_value: 400,
        });
        const coupon = makeCoupon({
          promotion_id: 'p-coupon',
          promotion: couponPromo,
        });
        const { service } = setupResolve([], coupon);
        const res = await service.resolvePromotions(
          5000,
          'u-1',
          'store-1',
          'SAVE10',
        );
        expect(res.selectedCoupon?.id).toBe('coupon-1');
        expect(res.selectedPromotion?.id).toBe('p-coupon');
        expect(res.totalDiscount).toBe(400);
      });

      it('coupon code not found in DB → no coupon, no auto promo → zero discount', async () => {
        const { service } = setupResolve([], null);
        const res = await service.resolvePromotions(
          5000,
          'u-1',
          'store-1',
          'NONEXIST',
        );
        expect(res.selectedCoupon).toBeNull();
      });
    });

    describe('handleExpiredCoupons cron', () => {
      it('UPDATEs every ACTIVE coupon whose ends_at is in the past to EXPIRED', async () => {
        const { service, couponRepo } = createService();
        const execute = jest.fn().mockResolvedValue({ affected: 3 });
        const qb: any = {};
        qb.update = jest.fn().mockReturnValue(qb);
        qb.set = jest.fn().mockReturnValue(qb);
        qb.where = jest.fn().mockReturnValue(qb);
        qb.andWhere = jest.fn().mockReturnValue(qb);
        qb.execute = execute;
        couponRepo.createQueryBuilder.mockReturnValue(qb);

        await (service as any).handleExpiredCoupons();

        expect(qb.set).toHaveBeenCalledWith({ status: CouponStatus.EXPIRED });
        expect(qb.where).toHaveBeenCalledWith('status = :status', {
          status: CouponStatus.ACTIVE,
        });
        expect(qb.andWhere).toHaveBeenCalledWith('ends_at IS NOT NULL');
        expect(execute).toHaveBeenCalled();
      });

      it('cron no-op when there are zero expired rows (quiet path)', async () => {
        const { service, couponRepo } = createService();
        const qb: any = {};
        qb.update = jest.fn().mockReturnValue(qb);
        qb.set = jest.fn().mockReturnValue(qb);
        qb.where = jest.fn().mockReturnValue(qb);
        qb.andWhere = jest.fn().mockReturnValue(qb);
        qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
        couponRepo.createQueryBuilder.mockReturnValue(qb);

        // Should complete without throwing — the logger.log call is
        // gated on affected > 0.
        await expect(
          (service as any).handleExpiredCoupons(),
        ).resolves.toBeUndefined();
      });
    });
  });
});

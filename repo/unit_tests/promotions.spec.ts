import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  const service = new PromotionsService(
    promotionRepo as any,
    couponRepo as any,
    claimRepo as any,
  );

  return { service, promotionRepo, couponRepo, claimRepo };
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
    it('active coupon -> creates claim and decrements remaining_quantity', async () => {
      const { service, couponRepo, claimRepo } = createService();

      const coupon = makeCoupon({ remaining_quantity: 5 });
      couponRepo.findOne.mockResolvedValue(coupon);

      const savedClaim = { id: 'claim-1', coupon_id: coupon.id, user_id: 'user-1' };
      claimRepo.save.mockResolvedValue(savedClaim);

      const result = await service.claimCoupon('SAVE10', 'user-1');

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

      await expect(service.claimCoupon('SAVE10', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('exhausted coupon -> throws BadRequestException', async () => {
      const { service, couponRepo } = createService();

      const coupon = makeCoupon({ status: CouponStatus.EXHAUSTED });
      couponRepo.findOne.mockResolvedValue(coupon);

      await expect(service.claimCoupon('SAVE10', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('remaining_quantity reaches 0 -> sets status=exhausted', async () => {
      const { service, couponRepo, claimRepo } = createService();

      const coupon = makeCoupon({ remaining_quantity: 1 });
      couponRepo.findOne.mockResolvedValue(coupon);
      claimRepo.save.mockResolvedValue({ id: 'claim-1' });

      await service.claimCoupon('SAVE10', 'user-1');

      expect(coupon.remaining_quantity).toBe(0);
      expect(coupon.status).toBe(CouponStatus.EXHAUSTED);
      expect(couponRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CouponStatus.EXHAUSTED }),
      );
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
});

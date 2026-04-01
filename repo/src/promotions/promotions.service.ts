import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Promotion, PromotionType, DiscountType } from './entities/promotion.entity';
import { Coupon, CouponStatus } from './entities/coupon.entity';
import { CouponClaim } from './entities/coupon-claim.entity';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';

export interface ResolvedPromotion {
  selectedPromotion: Promotion | null;
  selectedCoupon: Coupon | null;
  totalDiscount: number;
}

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepo: Repository<Promotion>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CouponClaim)
    private readonly claimRepo: Repository<CouponClaim>,
  ) {}

  async createPromotion(dto: CreatePromotionDto): Promise<Promotion> {
    const promotion = this.promotionRepo.create({
      store_id: dto.storeId,
      name: dto.name,
      type: dto.type,
      priority: dto.priority,
      discount_type: dto.discountType,
      discount_value: dto.discountValue,
      min_order_cents: dto.minOrderCents ?? null,
      starts_at: dto.startsAt ? new Date(dto.startsAt) : null,
      ends_at: dto.endsAt ? new Date(dto.endsAt) : null,
      redemption_cap: dto.redemptionCap ?? null,
    });
    return this.promotionRepo.save(promotion);
  }

  async createCoupon(dto: CreateCouponDto): Promise<Coupon> {
    const coupon = this.couponRepo.create({
      store_id: dto.storeId,
      code: dto.code,
      promotion_id: dto.promotionId,
      remaining_quantity: dto.remainingQuantity ?? null,
      starts_at: dto.startsAt ? new Date(dto.startsAt) : null,
      ends_at: dto.endsAt ? new Date(dto.endsAt) : null,
    });
    return this.couponRepo.save(coupon);
  }

  async claimCoupon(code: string, userId: string): Promise<CouponClaim> {
    const coupon = await this.couponRepo.findOne({ where: { code } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BadRequestException(`Coupon is ${coupon.status}`);
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      throw new BadRequestException('Coupon is not yet active');
    }
    if (coupon.ends_at && now > coupon.ends_at) {
      throw new BadRequestException('Coupon has expired');
    }

    const claim = this.claimRepo.create({
      coupon_id: coupon.id,
      user_id: userId,
      claimed_at: now,
    });
    const savedClaim = await this.claimRepo.save(claim);

    if (coupon.remaining_quantity !== null) {
      coupon.remaining_quantity -= 1;
      if (coupon.remaining_quantity <= 0) {
        coupon.status = CouponStatus.EXHAUSTED;
      }
      await this.couponRepo.save(coupon);
    }

    return savedClaim;
  }

  async distributeCoupon(couponId: string, userIds: string[]): Promise<CouponClaim[]> {
    const coupon = await this.couponRepo.findOne({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const now = new Date();
    const claims = userIds.map((userId) =>
      this.claimRepo.create({
        coupon_id: couponId,
        user_id: userId,
        claimed_at: now,
      }),
    );

    return this.claimRepo.save(claims);
  }

  async redeemCoupon(
    code: string,
    userId: string,
    orderId: string,
  ): Promise<CouponClaim> {
    const coupon = await this.couponRepo.findOne({ where: { code } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const claim = await this.claimRepo.findOne({
      where: { coupon_id: coupon.id, user_id: userId, redeemed_at: IsNull() },
    });
    if (!claim) {
      throw new NotFoundException('No unredeemed claim found for this user');
    }

    claim.redeemed_at = new Date();
    claim.order_id = orderId;
    return this.claimRepo.save(claim);
  }

  async expireCoupon(id: string): Promise<Coupon> {
    const coupon = await this.couponRepo.findOne({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    coupon.status = CouponStatus.EXPIRED;
    return this.couponRepo.save(coupon);
  }

  async findPromotions(storeId?: string): Promise<Promotion[]> {
    const where: any = {};
    if (storeId) {
      where.store_id = storeId;
    }
    return this.promotionRepo.find({ where });
  }

  async findCoupons(storeId?: string): Promise<Coupon[]> {
    const where: any = {};
    if (storeId) {
      where.store_id = storeId;
    }
    return this.couponRepo.find({ where });
  }

  async updatePromotion(
    id: string,
    dto: Partial<any>,
    storeId?: string,
  ): Promise<Promotion> {
    const where: any = { id };
    if (storeId) where.store_id = storeId;
    const promo = await this.promotionRepo.findOne({ where });
    if (!promo) throw new NotFoundException('Promotion not found');
    if (dto.name !== undefined) promo.name = dto.name;
    if (dto.type !== undefined) promo.type = dto.type;
    if (dto.priority !== undefined) promo.priority = dto.priority;
    if (dto.discountType !== undefined) promo.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) promo.discount_value = dto.discountValue;
    if (dto.minOrderCents !== undefined) promo.min_order_cents = dto.minOrderCents;
    if (dto.startsAt !== undefined) promo.starts_at = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined) promo.ends_at = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.redemptionCap !== undefined) promo.redemption_cap = dto.redemptionCap;
    if (dto.active !== undefined) promo.active = dto.active;
    return this.promotionRepo.save(promo);
  }

  async deletePromotion(id: string, storeId?: string): Promise<void> {
    const where: any = { id };
    if (storeId) where.store_id = storeId;
    const promo = await this.promotionRepo.findOne({ where });
    if (!promo) throw new NotFoundException('Promotion not found');
    await this.promotionRepo.remove(promo);
  }

  calculateDiscount(promotion: Promotion, orderTotalCents: number): number {
    if (
      promotion.min_order_cents !== null &&
      orderTotalCents < promotion.min_order_cents
    ) {
      return 0;
    }

    if (promotion.discount_type === DiscountType.FIXED_CENTS) {
      return promotion.discount_value;
    }

    // percentage
    return Math.floor((orderTotalCents * promotion.discount_value) / 100);
  }

  async resolvePromotions(
    orderTotalCents: number,
    userId: string,
    storeId: string,
    couponCode?: string,
  ): Promise<ResolvedPromotion> {
    const now = new Date();

    // 1. Find all active automatic promotions for the store within time window, not capped
    const qb = this.promotionRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.active = true')
      .andWhere('(p.starts_at IS NULL OR p.starts_at <= :now)', { now })
      .andWhere('(p.ends_at IS NULL OR p.ends_at >= :now)', { now })
      .andWhere(
        '(p.redemption_cap IS NULL OR p.redemption_count < p.redemption_cap)',
      );

    const autoPromotions = await qb.getMany();

    // Filter out first_order promotions if user has prior orders
    const filteredPromotions: Promotion[] = [];
    for (const promo of autoPromotions) {
      if (promo.type === PromotionType.FIRST_ORDER) {
        // Check if user has any prior redeemed claims (proxy for orders)
        const priorClaim = await this.claimRepo.findOne({
          where: { user_id: userId, redeemed_at: MoreThanOrEqual(new Date(0)) },
        });
        if (priorClaim) {
          continue; // skip first_order promo if user has prior orders
        }
      }
      filteredPromotions.push(promo);
    }

    // 3. Sort by priority DESC
    filteredPromotions.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // 4. Tie-break: highest effective discount
      const discA = this.calculateDiscount(a, orderTotalCents);
      const discB = this.calculateDiscount(b, orderTotalCents);
      if (discB !== discA) return discB - discA;
      // 5. Still tied: lower UUID wins
      return a.id < b.id ? -1 : 1;
    });

    const bestAutoPromo = filteredPromotions.length > 0 ? filteredPromotions[0] : null;

    // 2. If couponCode provided, validate coupon and get linked promotion
    let selectedCoupon: Coupon | null = null;
    let couponPromotion: Promotion | null = null;

    if (couponCode) {
      const coupon = await this.couponRepo.findOne({
        where: { code: couponCode },
        relations: ['promotion'],
      });

      if (
        coupon &&
        coupon.status === CouponStatus.ACTIVE &&
        (!coupon.starts_at || coupon.starts_at <= now) &&
        (!coupon.ends_at || coupon.ends_at >= now)
      ) {
        selectedCoupon = coupon;
        couponPromotion = coupon.promotion;
      }
    }

    // 8. Max one coupon + one automatic promotion per order
    let totalDiscount = 0;
    let selectedPromotion: Promotion | null = null;

    if (bestAutoPromo) {
      const autoDiscount = this.calculateDiscount(bestAutoPromo, orderTotalCents);
      if (autoDiscount > 0) {
        totalDiscount += autoDiscount;
        selectedPromotion = bestAutoPromo;
      }
    }

    if (couponPromotion) {
      const couponDiscount = this.calculateDiscount(couponPromotion, orderTotalCents);
      if (couponDiscount > 0) {
        totalDiscount += couponDiscount;
        // If no auto promo was selected, the coupon promotion becomes the selected one
        if (!selectedPromotion) {
          selectedPromotion = couponPromotion;
        }
      }
    }

    return {
      selectedPromotion,
      selectedCoupon,
      totalDiscount,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredCoupons(): Promise<void> {
    const now = new Date();
    const result = await this.couponRepo
      .createQueryBuilder()
      .update(Coupon)
      .set({ status: CouponStatus.EXPIRED })
      .where('status = :status', { status: CouponStatus.ACTIVE })
      .andWhere('ends_at IS NOT NULL')
      .andWhere('ends_at < :now', { now })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} coupons`);
    }
  }
}

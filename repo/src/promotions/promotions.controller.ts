import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { DistributeCouponDto } from './dto/distribute-coupon.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('promotions')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Resolves the effective store filter for the calling user.
   *
   * audit_report-2 P0-5: previously each list/create/update/delete
   * controller branch did `user.role === 'store_admin' ? user.storeId
   * : undefined`. If the JWT carried role=store_admin with no storeId
   * (a broken role/store invariant — see auth.service P0-5 fix), this
   * silently passed `undefined` to the service, which then returned
   * EVERY store's promotions/coupons. That's both a tenant-isolation
   * leak AND an inconsistency with how every other store-scoped
   * service (orders, products, questions) fails fast.
   *
   * This helper centralises the resolution and throws 403 if a
   * store_admin reaches it without an assigned store. Non-store_admin
   * callers are returned `undefined` (no scope filter).
   */
  private resolveStoreScope(user: any): string | undefined {
    if (user?.role !== 'store_admin') {
      return undefined;
    }
    const storeId = user?.storeId ?? user?.store_id ?? null;
    if (!storeId) {
      throw new ForbiddenException('Store admin has no assigned store');
    }
    return storeId;
  }

  // ---- Promotions ----

  @Get('promotions')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List promotions' })
  @ApiResponse({ status: 200, description: 'List of promotions' })
  findPromotions(@CurrentUser() user: any) {
    const storeId = this.resolveStoreScope(user);
    return this.promotionsService.findPromotions(storeId);
  }

  @Post('promotions')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a promotion' })
  @ApiResponse({ status: 201, description: 'Promotion created' })
  async createPromotion(
    @Body() dto: CreatePromotionDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const callerStoreId = this.resolveStoreScope(user);
    if (callerStoreId) {
      // store_admin: pin storeId to JWT scope, ignoring whatever the
      // body claimed. Non-store_admin keeps caller-supplied storeId.
      dto.storeId = callerStoreId;
    }
    const promotion = await this.promotionsService.createPromotion(dto);
    await this.auditService.log(
      user.id,
      'create_promotion',
      'promotion',
      promotion.id,
      undefined,
      traceId,
    );
    return promotion;
  }

  @Patch('promotions/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Update a promotion' })
  @ApiResponse({ status: 200, description: 'Promotion updated' })
  updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreatePromotionDto>,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const storeId = this.resolveStoreScope(user);
    return this.promotionsService.updatePromotion(id, dto, storeId).then(async (promotion) => {
      await this.auditService.log(
        user.id,
        'update_promotion',
        'promotion',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return promotion;
    });
  }

  @Delete('promotions/:id')
  @Roles('store_admin', 'platform_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a promotion' })
  @ApiResponse({ status: 204, description: 'Promotion deleted' })
  deletePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const storeId = this.resolveStoreScope(user);
    return this.promotionsService.deletePromotion(id, storeId).then(async () => {
      await this.auditService.log(
        user.id,
        'delete_promotion',
        'promotion',
        id,
        undefined,
        traceId,
      );
      return;
    });
  }

  // ---- Coupons ----

  @Get('coupons')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List coupons' })
  @ApiResponse({ status: 200, description: 'List of coupons' })
  findCoupons(@CurrentUser() user: any) {
    const storeId = this.resolveStoreScope(user);
    return this.promotionsService.findCoupons(storeId);
  }

  @Post('coupons')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a coupon' })
  @ApiResponse({ status: 201, description: 'Coupon created' })
  async createCoupon(
    @Body() dto: CreateCouponDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const callerStoreId = this.resolveStoreScope(user);
    if (callerStoreId) {
      // store_admin: pin storeId to JWT scope, ignoring whatever the
      // body claimed. Non-store_admin keeps caller-supplied storeId.
      dto.storeId = callerStoreId;
    }
    const coupon = await this.promotionsService.createCoupon(dto);
    await this.auditService.log(
      user.id,
      'create_coupon',
      'coupon',
      coupon.id,
      undefined,
      traceId,
    );
    return coupon;
  }

  @Post('coupons/:code/claim')
  @Roles('store_admin', 'platform_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Claim a coupon' })
  @ApiResponse({ status: 201, description: 'Coupon claimed' })
  @ApiResponse({
    status: 403,
    description:
      'Caller role is not permitted to mutate coupon state (e.g. auditor)',
  })
  async claimCoupon(
    @Param('code') code: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    // HIGH-2 / audit_report-1 — `claim` is a write surface (decrements
    // `remaining_quantity`, may flip the coupon to EXHAUSTED, creates a
    // CouponClaim row). Without an explicit @Roles decorator, the
    // RolesGuard returned `true` for any authenticated caller, which
    // let the read-only `auditor` role mutate coupon state. The
    // restriction here aligns claim with the rest of the coupon write
    // surfaces (`POST /coupons`, `/distribute`, `/expire`).
    //
    // audit_report-2 P0-2: pass the FULL user context (not just `id`)
    // so the service can enforce coupon.store_id ownership for
    // store_admin via the same hiding policy as distribute/redeem.
    const claim = await this.promotionsService.claimCoupon(code, user);
    await this.auditService.log(
      user.id,
      'claim_coupon',
      'coupon',
      claim.coupon_id,
      { code },
      traceId,
    );
    return claim;
  }

  @Post('coupons/:code/redeem')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Redeem a coupon for an order' })
  @ApiResponse({ status: 200, description: 'Coupon redeemed' })
  redeemCoupon(
    @Param('code') code: string,
    @Body('userId') userId: string,
    @Body('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.promotionsService.redeemCoupon(code, userId, orderId, user);
  }

  @Post('coupons/:id/distribute')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Distribute a coupon to multiple users' })
  @ApiResponse({ status: 201, description: 'Coupon distributed' })
  distributeCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DistributeCouponDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.promotionsService.distributeCoupon(id, dto.userIds, user).then(async (claims) => {
      await this.auditService.log(
        user.id,
        'distribute_coupon',
        'coupon',
        id,
        { recipientCount: dto.userIds.length },
        traceId,
      );
      return claims;
    });
  }

  @Post('coupons/:id/expire')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Expire a coupon' })
  @ApiResponse({ status: 200, description: 'Coupon expired' })
  expireCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.promotionsService.expireCoupon(id, user).then(async (coupon) => {
      await this.auditService.log(
        user.id,
        'expire_coupon',
        'coupon',
        id,
        undefined,
        traceId,
      );
      return coupon;
    });
  }
}

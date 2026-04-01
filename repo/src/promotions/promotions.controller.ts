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

@ApiTags('promotions')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  // ---- Promotions ----

  @Get('promotions')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List promotions' })
  @ApiResponse({ status: 200, description: 'List of promotions' })
  findPromotions(@CurrentUser() user: any) {
    const storeId = user.role === 'store_admin' ? user.storeId : undefined;
    return this.promotionsService.findPromotions(storeId);
  }

  @Post('promotions')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a promotion' })
  @ApiResponse({ status: 201, description: 'Promotion created' })
  createPromotion(@Body() dto: CreatePromotionDto, @CurrentUser() user: any) {
    if (user.role === 'store_admin') {
      dto.storeId = user.storeId;
    }
    return this.promotionsService.createPromotion(dto);
  }

  @Patch('promotions/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Update a promotion' })
  @ApiResponse({ status: 200, description: 'Promotion updated' })
  updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreatePromotionDto>,
    @CurrentUser() user: any,
  ) {
    const storeId = user.role === 'store_admin' ? user.storeId : undefined;
    return this.promotionsService.updatePromotion(id, dto, storeId);
  }

  @Delete('promotions/:id')
  @Roles('store_admin', 'platform_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a promotion' })
  @ApiResponse({ status: 204, description: 'Promotion deleted' })
  deletePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const storeId = user.role === 'store_admin' ? user.storeId : undefined;
    return this.promotionsService.deletePromotion(id, storeId);
  }

  // ---- Coupons ----

  @Get('coupons')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List coupons' })
  @ApiResponse({ status: 200, description: 'List of coupons' })
  findCoupons(@CurrentUser() user: any) {
    const storeId = user.role === 'store_admin' ? user.storeId : undefined;
    return this.promotionsService.findCoupons(storeId);
  }

  @Post('coupons')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a coupon' })
  @ApiResponse({ status: 201, description: 'Coupon created' })
  createCoupon(@Body() dto: CreateCouponDto, @CurrentUser() user: any) {
    if (user.role === 'store_admin') {
      dto.storeId = user.storeId;
    }
    return this.promotionsService.createCoupon(dto);
  }

  @Post('coupons/:code/claim')
  @ApiOperation({ summary: 'Claim a coupon' })
  @ApiResponse({ status: 201, description: 'Coupon claimed' })
  claimCoupon(
    @Param('code') code: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.promotionsService.claimCoupon(code, userId);
  }

  @Post('coupons/:code/redeem')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Redeem a coupon for an order' })
  @ApiResponse({ status: 200, description: 'Coupon redeemed' })
  redeemCoupon(
    @Param('code') code: string,
    @Body('userId') userId: string,
    @Body('orderId') orderId: string,
  ) {
    return this.promotionsService.redeemCoupon(code, userId, orderId);
  }

  @Post('coupons/:id/distribute')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Distribute a coupon to multiple users' })
  @ApiResponse({ status: 201, description: 'Coupon distributed' })
  distributeCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DistributeCouponDto,
  ) {
    return this.promotionsService.distributeCoupon(id, dto.userIds);
  }

  @Post('coupons/:id/expire')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Expire a coupon' })
  @ApiResponse({ status: 200, description: 'Coupon expired' })
  expireCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotionsService.expireCoupon(id);
  }
}

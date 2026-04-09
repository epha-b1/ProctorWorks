import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create an order' })
  @ApiResponse({ status: 201, description: 'Order created' })
  @ApiResponse({ status: 200, description: 'Idempotent — existing order returned' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
    @TraceId() traceId?: string,
  ) {
    const { order, alreadyExisted } = await this.ordersService.createOrder(dto, user);
    res.status(alreadyExisted ? HttpStatus.OK : HttpStatus.CREATED);
    // HIGH-3 — only audit on the genuine create path. The dedup branch
    // is a no-op as far as state is concerned, so logging it would
    // pollute the audit trail with phantom "create_order" entries.
    if (!alreadyExisted) {
      await this.auditService.log(
        user.id,
        'create_order',
        'order',
        order.id,
        { storeId: order.store_id, totalCents: order.total_cents },
        traceId,
      );
    }
    return order;
  }

  @Get()
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List orders' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  findAll(@CurrentUser() user: any) {
    return this.ordersService.findAll(user);
  }

  @Get(':id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order details' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.ordersService.findById(id, user);
  }

  @Post(':id/confirm')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Confirm an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order confirmed' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  async confirmOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const order = await this.ordersService.confirmOrder(id, user);
    await this.auditService.log(
      user.id,
      'confirm_order',
      'order',
      id,
      { storeId: order.store_id },
      traceId,
    );
    return order;
  }

  @Post(':id/fulfill')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Fulfill an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order fulfilled' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  async fulfillOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const order = await this.ordersService.fulfillOrder(id, user);
    await this.auditService.log(
      user.id,
      'fulfill_order',
      'order',
      id,
      { storeId: order.store_id },
      traceId,
    );
    return order;
  }

  @Post(':id/cancel')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  async cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const order = await this.ordersService.cancelOrder(id, user);
    await this.auditService.log(
      user.id,
      'cancel_order',
      'order',
      id,
      { storeId: order.store_id },
      traceId,
    );
    return order;
  }
}

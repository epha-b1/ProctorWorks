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

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create an order' })
  @ApiResponse({ status: 201, description: 'Order created' })
  @ApiResponse({ status: 200, description: 'Idempotent — existing order returned' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, alreadyExisted } = await this.ordersService.createOrder(
      dto,
      user,
    );
    res.status(alreadyExisted ? HttpStatus.OK : HttpStatus.CREATED);
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
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findById(id);
  }

  @Post(':id/confirm')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Confirm an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order confirmed' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  confirmOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.confirmOrder(id);
  }

  @Post(':id/fulfill')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Fulfill an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order fulfilled' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  fulfillOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.fulfillOrder(id);
  }

  @Post(':id/cancel')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  cancelOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancelOrder(id);
  }
}

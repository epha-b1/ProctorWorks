import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(RolesGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  @Post('lots')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create an inventory lot' })
  @ApiResponse({ status: 201, description: 'Lot created' })
  async createLot(@Body() dto: CreateLotDto, @CurrentUser() user: any) {
    const lot = await this.inventoryService.createLot(dto, user);
    await this.auditService.log(user.id, 'create_inventory_lot', 'inventory_lot', lot.id, {
      skuId: dto.skuId,
    });
    return lot;
  }

  @Get('lots')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List inventory lots' })
  @ApiQuery({ name: 'skuId', required: false, type: 'string' })
  @ApiResponse({ status: 200, description: 'List of lots' })
  findAllLots(@CurrentUser() user: any, @Query('skuId') skuId?: string) {
    return this.inventoryService.findAllLots(user, skuId);
  }

  @Patch('lots/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Update an inventory lot' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lot updated' })
  updateLot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateLotDto>,
    @CurrentUser() user: any,
  ) {
    const updates: any = {};
    if (dto.batchCode !== undefined) updates.batch_code = dto.batchCode;
    if (dto.expirationDate !== undefined)
      updates.expiration_date = dto.expirationDate;
    if (dto.quantity !== undefined) updates.quantity = dto.quantity;
    return this.inventoryService.updateLot(id, updates, user).then(async (lot) => {
      await this.auditService.log(user.id, 'update_inventory_lot', 'inventory_lot', id, {
        fields: Object.keys(dto || {}),
      });
      return lot;
    });
  }

  @Post('adjust')
  @Roles('store_admin', 'platform_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust stock with idempotency' })
  @ApiResponse({ status: 200, description: 'Stock adjusted' })
  @ApiResponse({ status: 201, description: 'New adjustment created' })
  async adjustStock(
    @Body() dto: AdjustStockDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { adjustment, alreadyExisted } =
      await this.inventoryService.adjustStock(dto, userId, user);
    if (!alreadyExisted) {
      res.status(HttpStatus.CREATED);
    }
    await this.auditService.log(user.id, 'adjust_inventory_stock', 'inventory_lot', dto.lotId, {
      delta: dto.delta,
      reasonCode: dto.reasonCode,
      idempotencyKey: dto.idempotencyKey,
      alreadyExisted,
    });
    return adjustment;
  }
}

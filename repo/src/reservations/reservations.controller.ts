import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Reservations')
@ApiBearerAuth()
@Controller('reservations')
@UseGuards(RolesGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a seat hold (15 min)' })
  @ApiResponse({ status: 201, description: 'Hold created' })
  @ApiResponse({ status: 400, description: 'Seat under maintenance' })
  @ApiResponse({ status: 409, description: 'Active hold already exists' })
  createHold(
    @Body() dto: CreateReservationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.createHold(dto.seatId, userId);
  }

  @Get()
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List reservations with optional filters' })
  @ApiQuery({ name: 'seatId', required: false, type: 'string' })
  @ApiResponse({ status: 200, description: 'List of reservations' })
  findAll(@Query('seatId') seatId?: string) {
    // Endpoint is admin-only (see @Roles above), so there is no
    // non-admin self-filter branch here. The previous "if not admin
    // then filter by user.id" code was dead under the current role
    // policy and was removed per audit_report-1 §5.7.
    return this.reservationsService.findAll({ seatId });
  }

  @Post(':id/confirm')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Confirm a held reservation' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation confirmed' })
  @ApiResponse({ status: 409, description: 'Hold expired or invalid status' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.confirm(id, userId);
  }

  @Post(':id/cancel')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Cancel a reservation' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation cancelled' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.cancel(id, userId);
  }
}

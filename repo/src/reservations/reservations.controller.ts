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

@ApiTags('Reservations')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
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
  @ApiOperation({ summary: 'List reservations with optional filters' })
  @ApiQuery({ name: 'seatId', required: false, type: 'string' })
  @ApiQuery({ name: 'userId', required: false, type: 'string' })
  @ApiResponse({ status: 200, description: 'List of reservations' })
  findAll(
    @Query('seatId') seatId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.reservationsService.findAll({ seatId, userId });
  }

  @Post(':id/confirm')
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

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { CreateSeatDto } from './dto/create-seat.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';
import { PublishSeatMapDto } from './dto/publish-seat-map.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Rooms')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  /* ── Rooms ── */

  @Post('rooms')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a study room' })
  @ApiResponse({ status: 201, description: 'Room created' })
  createRoom(@Body() dto: CreateRoomDto) {
    return this.roomsService.createRoom(dto);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'List all study rooms' })
  @ApiResponse({ status: 200, description: 'List of rooms' })
  findAllRooms() {
    return this.roomsService.findAllRooms();
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: 'Get a study room by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Room details' })
  findRoom(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findRoomById(id);
  }

  @Patch('rooms/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Update a study room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Room updated' })
  updateRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomsService.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Delete a study room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Room deleted' })
  deleteRoom(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.deleteRoom(id);
  }

  /* ── Zones ── */

  @Get('rooms/:id/zones')
  @ApiOperation({ summary: 'List zones in a room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'List of zones' })
  findZones(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findZonesByRoom(id);
  }

  @Post('rooms/:id/zones')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a zone in a room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  createZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.roomsService.createZone(id, dto);
  }

  /* ── Seats ── */

  @Get('zones/:id/seats')
  @ApiOperation({ summary: 'List seats in a zone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'List of seats' })
  findSeats(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findSeatsByZone(id);
  }

  @Post('zones/:id/seats')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a seat in a zone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Seat created' })
  createSeat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSeatDto,
  ) {
    return this.roomsService.createSeat(id, dto);
  }

  @Patch('seats/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Update a seat' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Seat updated' })
  updateSeat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeatDto,
  ) {
    return this.roomsService.updateSeat(id, dto);
  }

  @Delete('seats/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Delete a seat' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Seat deleted' })
  deleteSeat(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.deleteSeat(id);
  }

  /* ── Seat-Map Versioning ── */

  @Post('rooms/:id/publish')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Publish a seat-map version snapshot' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Seat map version published' })
  publishSeatMap(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishSeatMapDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.publishSeatMap(id, dto.changeNote, userId);
  }

  @Get('rooms/:id/versions')
  @ApiOperation({ summary: 'List seat-map versions for a room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Version history' })
  getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.getVersions(id);
  }
}

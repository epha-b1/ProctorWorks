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
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('Rooms')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly auditService: AuditService,
  ) {}

  /* ── Rooms ── */

  @Post('rooms')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a study room' })
  @ApiResponse({ status: 201, description: 'Room created' })
  async createRoom(
    @Body() dto: CreateRoomDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const room = await this.roomsService.createRoom(dto);
    await this.auditService.log(
      actorId,
      'create_room',
      'room',
      room.id,
      undefined,
      traceId,
    );
    return room;
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
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.updateRoom(id, dto).then(async (room) => {
      await this.auditService.log(
        actorId,
        'update_room',
        'room',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return room;
    });
  }

  @Delete('rooms/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Delete a study room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Room deleted' })
  deleteRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.deleteRoom(id).then(async (result) => {
      await this.auditService.log(
        actorId,
        'delete_room',
        'room',
        id,
        undefined,
        traceId,
      );
      return result;
    });
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
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.createZone(id, dto).then(async (zone) => {
      await this.auditService.log(
        actorId,
        'create_zone',
        'zone',
        zone.id,
        { roomId: id },
        traceId,
      );
      return zone;
    });
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
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.createSeat(id, dto).then(async (seat) => {
      await this.auditService.log(
        actorId,
        'create_seat',
        'seat',
        seat.id,
        { zoneId: id },
        traceId,
      );
      return seat;
    });
  }

  @Patch('seats/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Update a seat' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Seat updated' })
  updateSeat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeatDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.updateSeat(id, dto).then(async (seat) => {
      await this.auditService.log(
        actorId,
        'update_seat',
        'seat',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return seat;
    });
  }

  @Delete('seats/:id')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Delete a seat' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Seat deleted' })
  deleteSeat(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.deleteSeat(id).then(async (result) => {
      await this.auditService.log(
        actorId,
        'delete_seat',
        'seat',
        id,
        undefined,
        traceId,
      );
      return result;
    });
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
    @TraceId() traceId?: string,
  ) {
    return this.roomsService.publishSeatMap(id, dto.changeNote, userId).then(async (version) => {
      await this.auditService.log(
        userId,
        'publish_seat_map',
        'room',
        id,
        { version: version.version_number },
        traceId,
      );
      return version;
    });
  }

  @Get('rooms/:id/versions')
  @ApiOperation({ summary: 'List seat-map versions for a room' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Version history' })
  getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.getVersions(id);
  }
}

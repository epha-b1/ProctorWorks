import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudyRoom } from './entities/study-room.entity';
import { Zone } from './entities/zone.entity';
import { Seat } from './entities/seat.entity';
import { SeatMapVersion } from './entities/seat-map-version.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { CreateSeatDto } from './dto/create-seat.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(StudyRoom)
    private readonly roomRepo: Repository<StudyRoom>,
    @InjectRepository(Zone)
    private readonly zoneRepo: Repository<Zone>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
    @InjectRepository(SeatMapVersion)
    private readonly seatMapVersionRepo: Repository<SeatMapVersion>,
  ) {}

  /* ── Rooms ── */

  async createRoom(dto: CreateRoomDto): Promise<StudyRoom> {
    const room = this.roomRepo.create(dto);
    return this.roomRepo.save(room);
  }

  async findAllRooms(): Promise<StudyRoom[]> {
    return this.roomRepo.find({ relations: ['zones', 'zones.seats'] });
  }

  async findRoomById(id: string): Promise<StudyRoom> {
    const room = await this.roomRepo.findOne({
      where: { id },
      relations: ['zones', 'zones.seats'],
    });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }

  async updateRoom(id: string, dto: Partial<CreateRoomDto>): Promise<StudyRoom> {
    const room = await this.findRoomById(id);
    Object.assign(room, dto);
    return this.roomRepo.save(room);
  }

  async deleteRoom(id: string): Promise<void> {
    const room = await this.findRoomById(id);
    await this.roomRepo.remove(room);
  }

  /* ── Zones ── */

  async createZone(roomId: string, dto: CreateZoneDto): Promise<Zone> {
    await this.findRoomById(roomId);
    const zone = this.zoneRepo.create({ ...dto, room_id: roomId });
    return this.zoneRepo.save(zone);
  }

  async findZonesByRoom(roomId: string): Promise<Zone[]> {
    await this.findRoomById(roomId);
    return this.zoneRepo.find({
      where: { room_id: roomId },
      relations: ['seats'],
    });
  }

  /* ── Seats ── */

  async createSeat(zoneId: string, dto: CreateSeatDto): Promise<Seat> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Zone ${zoneId} not found`);
    const seat = this.seatRepo.create({
      zone_id: zoneId,
      label: dto.label,
      power_outlet: dto.powerOutlet ?? false,
      quiet_zone: dto.quietZone ?? false,
      ada_accessible: dto.adaAccessible ?? false,
    });
    return this.seatRepo.save(seat);
  }

  async findSeatsByZone(zoneId: string): Promise<Seat[]> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Zone ${zoneId} not found`);
    return this.seatRepo.find({ where: { zone_id: zoneId } });
  }

  async updateSeat(id: string, dto: UpdateSeatDto): Promise<Seat> {
    const seat = await this.seatRepo.findOne({ where: { id } });
    if (!seat) throw new NotFoundException(`Seat ${id} not found`);
    if (dto.label !== undefined) seat.label = dto.label;
    if (dto.powerOutlet !== undefined) seat.power_outlet = dto.powerOutlet;
    if (dto.quietZone !== undefined) seat.quiet_zone = dto.quietZone;
    if (dto.adaAccessible !== undefined) seat.ada_accessible = dto.adaAccessible;
    if (dto.status !== undefined) seat.status = dto.status;
    return this.seatRepo.save(seat);
  }

  async deleteSeat(id: string): Promise<void> {
    const seat = await this.seatRepo.findOne({ where: { id } });
    if (!seat) throw new NotFoundException(`Seat ${id} not found`);
    await this.seatRepo.remove(seat);
  }

  /* ── Seat-Map Versioning ── */

  async publishSeatMap(
    roomId: string,
    changeNote: string,
    userId: string,
  ): Promise<SeatMapVersion> {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['zones', 'zones.seats'],
    });
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);

    // Build immutable snapshot
    const snapshot = {
      room: { id: room.id, name: room.name },
      zones: room.zones.map((z) => ({
        id: z.id,
        name: z.name,
        seats: z.seats.map((s) => ({
          id: s.id,
          label: s.label,
          power_outlet: s.power_outlet,
          quiet_zone: s.quiet_zone,
          ada_accessible: s.ada_accessible,
          status: s.status,
        })),
      })),
    };

    // Determine next version number
    const latest = await this.seatMapVersionRepo.findOne({
      where: { room_id: roomId },
      order: { version_number: 'DESC' },
    });
    const nextVersion = latest ? latest.version_number + 1 : 1;

    const version = this.seatMapVersionRepo.create({
      room_id: roomId,
      version_number: nextVersion,
      created_by: userId,
      change_note: changeNote,
      snapshot,
    });

    return this.seatMapVersionRepo.save(version);
  }

  async getVersions(roomId: string): Promise<SeatMapVersion[]> {
    await this.findRoomById(roomId);
    return this.seatMapVersionRepo.find({
      where: { room_id: roomId },
      order: { version_number: 'DESC' },
    });
  }
}

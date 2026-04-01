import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { Seat, SeatStatus } from '../rooms/entities/seat.entity';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
  ) {}

  async createHold(seatId: string, userId: string): Promise<Reservation> {
    // Check seat exists and is not in maintenance
    const seat = await this.seatRepo.findOne({ where: { id: seatId } });
    if (!seat) throw new NotFoundException(`Seat ${seatId} not found`);
    if (seat.status === SeatStatus.MAINTENANCE) {
      throw new BadRequestException('Seat is currently under maintenance');
    }

    // Check no active hold exists for this seat
    const activeHold = await this.reservationRepo.findOne({
      where: {
        seat_id: seatId,
        status: ReservationStatus.HOLD,
        hold_until: MoreThan(new Date()),
      },
    });
    if (activeHold) {
      throw new ConflictException('An active hold already exists for this seat');
    }

    const holdUntil = new Date(Date.now() + 15 * 60 * 1000);

    const reservation = this.reservationRepo.create({
      seat_id: seatId,
      user_id: userId,
      status: ReservationStatus.HOLD,
      hold_until: holdUntil,
    });

    return this.reservationRepo.save(reservation);
  }

  async confirm(reservationId: string, userId: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, user_id: userId },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    if (
      reservation.status !== ReservationStatus.HOLD ||
      reservation.hold_until <= new Date()
    ) {
      throw new ConflictException(
        'Reservation hold has expired or is not in hold status',
      );
    }

    reservation.status = ReservationStatus.CONFIRMED;
    reservation.confirmed_at = new Date();
    return this.reservationRepo.save(reservation);
  }

  async cancel(reservationId: string, userId: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, user_id: userId },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    reservation.status = ReservationStatus.CANCELLED;
    reservation.cancelled_at = new Date();
    return this.reservationRepo.save(reservation);
  }

  async findAll(filters?: {
    seatId?: string;
    userId?: string;
  }): Promise<Reservation[]> {
    const where: Record<string, any> = {};
    if (filters?.seatId) where.seat_id = filters.seatId;
    if (filters?.userId) where.user_id = filters.userId;

    return this.reservationRepo.find({
      where,
      order: { created_at: 'DESC' },
    });
  }

  @Cron('*/60 * * * * *')
  async releaseExpiredHolds(): Promise<void> {
    await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: ReservationStatus.EXPIRED })
      .where('status = :status', { status: ReservationStatus.HOLD })
      .andWhere('hold_until < NOW()')
      .execute();
  }
}

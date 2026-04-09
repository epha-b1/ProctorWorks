/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common';
import { RoomsService } from '../src/rooms/rooms.service';
import { Seat, SeatStatus } from '../src/rooms/entities/seat.entity';
import {
  Reservation,
  ReservationStatus,
} from '../src/reservations/entities/reservation.entity';

// ---------------------------------------------------------------------------
// MED — seat status transition to MAINTENANCE must cascade-cancel any
// active HOLD reservations for that seat in the same transaction.
//
// We construct a minimal RoomsService directly with a hand-rolled
// DataSource mock so we can capture the EntityManager calls the service
// makes inside the transaction. The assertions are precise:
//   1. The transaction callback runs.
//   2. The seat row is patched and saved.
//   3. The reservation cascade UPDATE fires with the right WHERE
//      clause (seat_id = X AND status = hold) when the seat is
//      transitioning INTO maintenance.
//   4. The cascade does NOT fire on a no-op or non-maintenance update.
// ---------------------------------------------------------------------------

function makeUpdateBuilderSpies() {
  const execute = jest.fn().mockResolvedValue({ affected: 1 });
  const andWhere = jest.fn().mockReturnValue({ execute });
  const where = jest.fn().mockReturnValue({ andWhere });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const createQueryBuilder = jest.fn().mockReturnValue({ update });
  return { createQueryBuilder, update, set, where, andWhere, execute };
}

function makeService(
  initialSeat: Seat | null,
  updateBuilder: ReturnType<typeof makeUpdateBuilderSpies>,
) {
  // The first findOne returns the existing seat (status snapshot).
  // Inside the transaction, the service re-fetches via the manager, so
  // we wire the manager.findOne to return the same row.
  const seatRepo = {
    findOne: jest.fn().mockResolvedValue(initialSeat),
  };

  const manager = {
    findOne: jest.fn().mockResolvedValue(
      initialSeat ? { ...initialSeat } : null,
    ),
    save: jest.fn().mockImplementation((entity: any) => Promise.resolve(entity)),
    createQueryBuilder: updateBuilder.createQueryBuilder,
  };

  const dataSource = {
    transaction: jest.fn().mockImplementation((cb: any) => cb(manager)),
  };

  const service = new RoomsService(
    {} as any, // roomRepo — unused on this code path
    {} as any, // zoneRepo — unused on this code path
    seatRepo as any,
    {} as any, // seatMapVersionRepo — unused on this code path
    dataSource as any,
  );

  return { service, dataSource, manager, seatRepo };
}

describe('RoomsService.updateSeat — seat → maintenance cascade', () => {
  const SEAT_ID = 'seat-uuid-1';

  it('cancels active holds when seat transitions AVAILABLE → MAINTENANCE', async () => {
    const seat: Partial<Seat> = {
      id: SEAT_ID,
      label: 'A1',
      power_outlet: false,
      quiet_zone: false,
      ada_accessible: false,
      status: SeatStatus.AVAILABLE,
    };
    const builder = makeUpdateBuilderSpies();
    const { service, dataSource } = makeService(seat as Seat, builder);

    const result = await service.updateSeat(SEAT_ID, {
      status: SeatStatus.MAINTENANCE,
    } as any);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result.status).toBe(SeatStatus.MAINTENANCE);

    // Reservation cascade UPDATE was constructed with the right shape.
    expect(builder.createQueryBuilder).toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith(Reservation);
    const setArg = builder.set.mock.calls[0][0];
    expect(setArg.status).toBe(ReservationStatus.CANCELLED);
    expect(setArg.cancelled_at).toBeInstanceOf(Date);
    expect(builder.where).toHaveBeenCalledWith('seat_id = :seatId', {
      seatId: SEAT_ID,
    });
    expect(builder.andWhere).toHaveBeenCalledWith('status = :status', {
      status: ReservationStatus.HOLD,
    });
    expect(builder.execute).toHaveBeenCalled();
  });

  it('does NOT cascade-cancel when seat is ALREADY in maintenance (idempotent)', async () => {
    const seat: Partial<Seat> = {
      id: SEAT_ID,
      label: 'A1',
      power_outlet: false,
      quiet_zone: false,
      ada_accessible: false,
      status: SeatStatus.MAINTENANCE,
    };
    const builder = makeUpdateBuilderSpies();
    const { service } = makeService(seat as Seat, builder);

    await service.updateSeat(SEAT_ID, {
      status: SeatStatus.MAINTENANCE,
    } as any);

    // No transition into maintenance happened — nothing to cascade.
    expect(builder.execute).not.toHaveBeenCalled();
  });

  it('does NOT cascade-cancel on a non-maintenance update (e.g. relabel)', async () => {
    const seat: Partial<Seat> = {
      id: SEAT_ID,
      label: 'A1',
      power_outlet: false,
      quiet_zone: false,
      ada_accessible: false,
      status: SeatStatus.AVAILABLE,
    };
    const builder = makeUpdateBuilderSpies();
    const { service } = makeService(seat as Seat, builder);

    await service.updateSeat(SEAT_ID, { label: 'A2' } as any);

    expect(builder.execute).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the seat does not exist', async () => {
    const builder = makeUpdateBuilderSpies();
    const { service } = makeService(null, builder);

    await expect(
      service.updateSeat(SEAT_ID, {
        status: SeatStatus.MAINTENANCE,
      } as any),
    ).rejects.toThrow(NotFoundException);

    expect(builder.execute).not.toHaveBeenCalled();
  });
});

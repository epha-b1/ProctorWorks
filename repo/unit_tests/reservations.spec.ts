import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationsService } from '../src/reservations/reservations.service';
import {
  Reservation,
  ReservationStatus,
} from '../src/reservations/entities/reservation.entity';
import { SeatStatus } from '../src/rooms/entities/seat.entity';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let reservationRepo: Record<string, jest.Mock>;
  let seatRepo: Record<string, jest.Mock>;

  const SEAT_ID = 'seat-uuid-1';
  const USER_ID = 'user-uuid-1';
  const RESERVATION_ID = 'res-uuid-1';

  beforeEach(() => {
    reservationRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    seatRepo = {
      findOne: jest.fn(),
    };

    service = new ReservationsService(
      reservationRepo as any,
      seatRepo as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------
  // createHold
  // ---------------------------------------------------------------

  describe('createHold', () => {
    it('creates a reservation with holdUntil = now + 15 minutes', async () => {
      const now = new Date('2026-03-31T12:00:00Z');
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime());

      const expectedHoldUntil = new Date(now.getTime() + 15 * 60 * 1000);

      seatRepo.findOne.mockResolvedValue({
        id: SEAT_ID,
        status: SeatStatus.AVAILABLE,
      });
      reservationRepo.findOne.mockResolvedValue(null); // no active hold
      reservationRepo.create.mockImplementation((dto) => ({ ...dto }));
      reservationRepo.save.mockImplementation((entity) =>
        Promise.resolve({ id: RESERVATION_ID, ...entity }),
      );

      const result = await service.createHold(SEAT_ID, USER_ID);

      expect(seatRepo.findOne).toHaveBeenCalledWith({
        where: { id: SEAT_ID },
      });
      expect(reservationRepo.create).toHaveBeenCalledWith({
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.HOLD,
        hold_until: expectedHoldUntil,
      });
      expect(reservationRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(ReservationStatus.HOLD);
      expect(result.hold_until).toEqual(expectedHoldUntil);
    });

    it('throws BadRequestException when seat is in maintenance', async () => {
      seatRepo.findOne.mockResolvedValue({
        id: SEAT_ID,
        status: SeatStatus.MAINTENANCE,
      });

      await expect(service.createHold(SEAT_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(reservationRepo.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an active hold already exists', async () => {
      seatRepo.findOne.mockResolvedValue({
        id: SEAT_ID,
        status: SeatStatus.AVAILABLE,
      });
      reservationRepo.findOne.mockResolvedValue({
        id: 'existing-hold',
        seat_id: SEAT_ID,
        status: ReservationStatus.HOLD,
        hold_until: new Date(Date.now() + 10 * 60 * 1000),
      });

      await expect(service.createHold(SEAT_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(reservationRepo.create).not.toHaveBeenCalled();
    });

    it('allows a new hold when the previous hold on the same seat has expired', async () => {
      seatRepo.findOne.mockResolvedValue({
        id: SEAT_ID,
        status: SeatStatus.AVAILABLE,
      });
      // No active (non-expired) hold found by the query
      reservationRepo.findOne.mockResolvedValue(null);
      reservationRepo.create.mockImplementation((dto) => ({ ...dto }));
      reservationRepo.save.mockImplementation((entity) =>
        Promise.resolve({ id: RESERVATION_ID, ...entity }),
      );

      const result = await service.createHold(SEAT_ID, USER_ID);

      expect(result.status).toBe(ReservationStatus.HOLD);
      expect(reservationRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when seat does not exist', async () => {
      seatRepo.findOne.mockResolvedValue(null);

      await expect(service.createHold(SEAT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------
  // confirm
  // ---------------------------------------------------------------

  describe('confirm', () => {
    it('sets status to confirmed and sets confirmed_at', async () => {
      const holdUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min from now — always valid
      const holdReservation = {
        id: RESERVATION_ID,
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.HOLD,
        hold_until: holdUntil,
        confirmed_at: null,
        cancelled_at: null,
      };

      reservationRepo.findOne.mockResolvedValue(holdReservation);
      reservationRepo.save.mockImplementation((entity) =>
        Promise.resolve({ ...entity }),
      );

      const result = await service.confirm(RESERVATION_ID, USER_ID);

      expect(result.status).toBe(ReservationStatus.CONFIRMED);
      expect(result.confirmed_at).toBeInstanceOf(Date);
      expect(reservationRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException when hold has expired', async () => {
      const expiredHold = {
        id: RESERVATION_ID,
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.HOLD,
        hold_until: new Date(Date.now() - 1000), // in the past
        confirmed_at: null,
      };

      reservationRepo.findOne.mockResolvedValue(expiredHold);

      await expect(
        service.confirm(RESERVATION_ID, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when reservation is already confirmed', async () => {
      const confirmedReservation = {
        id: RESERVATION_ID,
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.CONFIRMED,
        hold_until: new Date(Date.now() + 5 * 60 * 1000),
        confirmed_at: new Date(),
      };

      reservationRepo.findOne.mockResolvedValue(confirmedReservation);

      await expect(
        service.confirm(RESERVATION_ID, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      reservationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.confirm(RESERVATION_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------

  describe('cancel', () => {
    it('sets status to cancelled and sets cancelled_at', async () => {
      const reservation = {
        id: RESERVATION_ID,
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.HOLD,
        hold_until: new Date(Date.now() + 5 * 60 * 1000),
        cancelled_at: null,
      };

      reservationRepo.findOne.mockResolvedValue(reservation);
      reservationRepo.save.mockImplementation((entity) =>
        Promise.resolve({ ...entity }),
      );

      const result = await service.cancel(RESERVATION_ID, USER_ID);

      expect(result.status).toBe(ReservationStatus.CANCELLED);
      expect(result.cancelled_at).toBeInstanceOf(Date);
      expect(reservationRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      reservationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.cancel(RESERVATION_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------
  // releaseExpiredHolds
  // ---------------------------------------------------------------

  describe('releaseExpiredHolds', () => {
    it('updates expired holds to expired status via query builder', async () => {
      const executeMock = jest.fn().mockResolvedValue({ affected: 3 });
      const andWhereMock = jest.fn().mockReturnValue({ execute: executeMock });
      const whereMock = jest.fn().mockReturnValue({ andWhere: andWhereMock });
      const setMock = jest.fn().mockReturnValue({ where: whereMock });
      const updateMock = jest.fn().mockReturnValue({ set: setMock });

      reservationRepo.createQueryBuilder.mockReturnValue({
        update: updateMock,
      });

      await service.releaseExpiredHolds();

      expect(reservationRepo.createQueryBuilder).toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledWith(Reservation);
      expect(setMock).toHaveBeenCalledWith({
        status: ReservationStatus.EXPIRED,
      });
      expect(whereMock).toHaveBeenCalledWith('status = :status', {
        status: ReservationStatus.HOLD,
      });
      expect(andWhereMock).toHaveBeenCalledWith('hold_until < NOW()');
      expect(executeMock).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------

  describe('findAll', () => {
    const reservations = [
      {
        id: 'res-1',
        seat_id: SEAT_ID,
        user_id: USER_ID,
        status: ReservationStatus.CONFIRMED,
      },
      {
        id: 'res-2',
        seat_id: SEAT_ID,
        user_id: 'user-uuid-2',
        status: ReservationStatus.HOLD,
      },
    ];

    it('returns all reservations when no filters are provided', async () => {
      reservationRepo.find.mockResolvedValue(reservations);

      const result = await service.findAll();

      expect(reservationRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual(reservations);
    });

    it('filters by seatId when provided', async () => {
      reservationRepo.find.mockResolvedValue([reservations[0]]);

      const result = await service.findAll({ seatId: SEAT_ID });

      expect(reservationRepo.find).toHaveBeenCalledWith({
        where: { seat_id: SEAT_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });

    it('filters by userId when provided', async () => {
      reservationRepo.find.mockResolvedValue([reservations[0]]);

      const result = await service.findAll({ userId: USER_ID });

      expect(reservationRepo.find).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });

    it('filters by both seatId and userId when provided', async () => {
      reservationRepo.find.mockResolvedValue([reservations[0]]);

      const result = await service.findAll({
        seatId: SEAT_ID,
        userId: USER_ID,
      });

      expect(reservationRepo.find).toHaveBeenCalledWith({
        where: { seat_id: SEAT_ID, user_id: USER_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });
});

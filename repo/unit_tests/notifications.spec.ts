/// <reference types="jest" />
import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../src/notifications/notifications.service';

function makeRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((plain: any) => ({ ...plain })),
    createQueryBuilder: jest.fn(),
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    notificationRepo = makeRepo();
    userRepo = makeRepo();
    service = new NotificationsService(
      notificationRepo as any,
      userRepo as any,
    );
  });

  describe('create', () => {
    it('persists a notification wired to the caller user_id, type, message', async () => {
      notificationRepo.save.mockImplementation(async (n: any) => ({
        id: 'n-1',
        read: false,
        created_at: new Date(),
        ...n,
      }));

      const result = await service.create('user-1', 'low_stock', 'SKU low');

      expect(notificationRepo.create).toHaveBeenCalledWith({
        user_id: 'user-1',
        type: 'low_stock',
        message: 'SKU low',
      });
      expect(notificationRepo.save).toHaveBeenCalledTimes(1);
      expect(result.user_id).toBe('user-1');
      expect(result.type).toBe('low_stock');
    });
  });

  describe('createForAdmins', () => {
    it('creates one notification per platform_admin/store_admin user', async () => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([
        { id: 'a1' },
        { id: 'a2' },
        { id: 'a3' },
      ]);
      userRepo.createQueryBuilder.mockReturnValue(qb);
      notificationRepo.save.mockImplementation(async (ns: any) => ns);

      await service.createForAdmins('stale_data', 'Freshness warning');

      expect(qb.where).toHaveBeenCalledWith('user.role IN (:...roles)', {
        roles: ['platform_admin', 'store_admin'],
      });
      // save called with an ARRAY of 3 prepared notifications.
      const [savedArg] = notificationRepo.save.mock.calls[0];
      expect(Array.isArray(savedArg)).toBe(true);
      expect(savedArg).toHaveLength(3);
      expect(savedArg[0]).toMatchObject({
        user_id: 'a1',
        type: 'stale_data',
        message: 'Freshness warning',
      });
    });

    it('is a no-op (save called with empty array) when there are zero admins', async () => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      userRepo.createQueryBuilder.mockReturnValue(qb);
      notificationRepo.save.mockResolvedValue([]);

      await service.createForAdmins('x', 'y');

      const [savedArg] = notificationRepo.save.mock.calls[0];
      expect(savedArg).toEqual([]);
    });
  });

  describe('findByUser', () => {
    it('no readFilter → queries only by user_id, ordered by created_at DESC', async () => {
      notificationRepo.find.mockResolvedValue([]);
      await service.findByUser('user-1');
      expect(notificationRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        order: { created_at: 'DESC' },
      });
    });

    it('readFilter=true → filters read=true', async () => {
      notificationRepo.find.mockResolvedValue([]);
      await service.findByUser('user-1', true);
      expect(notificationRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read: true },
        order: { created_at: 'DESC' },
      });
    });

    it('readFilter=false → filters read=false (explicit unread)', async () => {
      notificationRepo.find.mockResolvedValue([]);
      await service.findByUser('user-1', false);
      expect(notificationRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read: false },
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('markAsRead', () => {
    it('marks unread → read and persists when caller owns the notification', async () => {
      notificationRepo.findOne.mockResolvedValue({
        id: 'n-1',
        user_id: 'user-1',
        read: false,
      });
      notificationRepo.save.mockImplementation(async (n: any) => n);

      const result = await service.markAsRead('n-1', 'user-1');

      expect(result.read).toBe(true);
      expect(notificationRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when notification does not exist', async () => {
      notificationRepo.findOne.mockResolvedValue(null);
      await expect(service.markAsRead('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not the owner', async () => {
      notificationRepo.findOne.mockResolvedValue({
        id: 'n-1',
        user_id: 'user-OTHER',
        read: false,
      });
      await expect(service.markAsRead('n-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });
  });
});

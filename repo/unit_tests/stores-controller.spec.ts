/// <reference types="jest" />
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { StoresController } from '../src/auth/stores.controller';

function makeStoreRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((plain: any) => ({ ...plain })),
    save: jest.fn(async (s: any) => ({ id: s.id ?? 'store-new', ...s })),
    remove: jest.fn(async (s: any) => s),
  };
}

describe('StoresController', () => {
  let storeRepo: ReturnType<typeof makeStoreRepo>;
  let audit: { log: jest.Mock };
  let controller: StoresController;

  beforeEach(() => {
    storeRepo = makeStoreRepo();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    controller = new StoresController(storeRepo as any, audit as any);
  });

  describe('findAll', () => {
    it('returns stores ordered by created_at DESC', async () => {
      storeRepo.find.mockResolvedValue([{ id: 's-1' }]);
      const result = await controller.findAll();
      expect(storeRepo.find).toHaveBeenCalledWith({
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual([{ id: 's-1' }]);
    });
  });

  describe('create', () => {
    it('saves a new store and logs a create_store audit entry with the resolved id', async () => {
      storeRepo.save.mockResolvedValue({ id: 'store-abc', name: 'North' });

      const saved = await controller.create(
        { name: 'North' } as any,
        'actor-1',
        'trace-1',
      );

      expect(storeRepo.create).toHaveBeenCalledWith({ name: 'North' });
      expect(saved.id).toBe('store-abc');
      expect(audit.log).toHaveBeenCalledWith(
        'actor-1',
        'create_store',
        'store',
        'store-abc',
        { name: 'North' },
        'trace-1',
      );
    });
  });

  describe('update', () => {
    it('updates name and logs update_store with the dto fields', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's-1', name: 'Old' });
      storeRepo.save.mockResolvedValue({ id: 's-1', name: 'New' });

      const result = await controller.update(
        's-1',
        { name: 'New' } as any,
        'actor-1',
        'trace-7',
      );

      expect(result.name).toBe('New');
      expect(audit.log).toHaveBeenCalledWith(
        'actor-1',
        'update_store',
        'store',
        's-1',
        { fields: ['name'] },
        'trace-7',
      );
    });

    it('no-ops gracefully when name is undefined (keeps prior name, still saves)', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's-1', name: 'Unchanged' });
      storeRepo.save.mockResolvedValue({ id: 's-1', name: 'Unchanged' });

      const result = await controller.update(
        's-1',
        {} as any,
        'actor-1',
      );

      expect(result.name).toBe('Unchanged');
      expect(audit.log).toHaveBeenCalledWith(
        'actor-1',
        'update_store',
        'store',
        's-1',
        { fields: [] },
        undefined,
      );
    });

    it('throws NotFoundException when the store id does not resolve', async () => {
      storeRepo.findOne.mockResolvedValue(null);
      await expect(
        controller.update('missing', { name: 'X' } as any, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(storeRepo.save).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the store and logs delete_store', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's-1', name: 'Gone' });

      await controller.remove('s-1', 'actor-1', 'trace-d');

      expect(storeRepo.remove).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        'actor-1',
        'delete_store',
        'store',
        's-1',
        undefined,
        'trace-d',
      );
    });

    it('throws NotFoundException when the store id does not resolve', async () => {
      storeRepo.findOne.mockResolvedValue(null);
      await expect(
        controller.remove('missing', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(storeRepo.remove).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});

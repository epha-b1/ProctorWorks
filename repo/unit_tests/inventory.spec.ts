/// <reference types="jest" />
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../src/inventory/inventory.service';

function makeRepo() {
  return {
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => v),
    findOne: jest.fn() as any,
    find: jest.fn() as any,
    createQueryBuilder: jest.fn() as any,
  };
}

function makeChain(getOneValue: any = null, getManyValue: any[] = []) {
  return {
    innerJoin: (jest.fn() as any).mockReturnThis(),
    leftJoin: (jest.fn() as any).mockReturnThis(),
    leftJoinAndSelect: (jest.fn() as any).mockReturnThis(),
    where: (jest.fn() as any).mockReturnThis(),
    andWhere: (jest.fn() as any).mockReturnThis(),
    getOne: (jest.fn() as any).mockResolvedValue(getOneValue),
    getMany: (jest.fn() as any).mockResolvedValue(getManyValue),
  };
}

describe('InventoryService', () => {
  let lotRepo: ReturnType<typeof makeRepo>;
  let adjustmentRepo: ReturnType<typeof makeRepo>;
  let skuRepo: ReturnType<typeof makeRepo>;
  let configService: { get: ReturnType<typeof jest.fn> };
  let notificationsService: { createForAdmins: ReturnType<typeof jest.fn> };
  let service: InventoryService;

  beforeEach(() => {
    lotRepo = makeRepo();
    adjustmentRepo = makeRepo();
    skuRepo = makeRepo();
    configService = { get: jest.fn().mockReturnValue(10) };
    notificationsService = { createForAdmins: jest.fn() };

    service = new InventoryService(
      lotRepo as any,
      adjustmentRepo as any,
      skuRepo as any,
      configService as any,
      notificationsService as any,
    );
  });

  it('requires store assignment for store_admin', async () => {
    await expect(
      service.findAllLots({ id: 'u1', role: 'store_admin' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects create lot when sku is outside store scope', async () => {
    const skuQb = makeChain(null);
    skuRepo.createQueryBuilder.mockReturnValue(skuQb);

    await expect(
      service.createLot(
        {
          skuId: 'sku-1',
          batchCode: 'BATCH',
          quantity: 10,
          expirationDate: null,
        } as any,
        { id: 'u1', role: 'store_admin', storeId: 'store-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('blocks idempotent replay if adjustment lot is not in operator store', async () => {
    adjustmentRepo.findOne.mockResolvedValue({
      id: 'adj-1',
      idempotency_key: 'idem-1',
      lot_id: 'lot-x',
    });

    const lotQb = makeChain(null);
    lotRepo.createQueryBuilder.mockReturnValue(lotQb);

    await expect(
      service.adjustStock(
        {
          lotId: 'lot-x',
          delta: 3,
          reasonCode: 'restock',
          idempotencyKey: 'idem-1',
        } as any,
        'u1',
        { id: 'u1', role: 'store_admin', storeId: 'store-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

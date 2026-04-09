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

/**
 * Builds the chain mocks the new transactional `adjustStock` flow expects:
 *   - lot lock (createQueryBuilder(InventoryLot, 'lot') .setLock... .getOne)
 *   - optional store-scope check (createQueryBuilder(InventoryLot, 'lot') .innerJoin... .getCount)
 *   - insert with ON CONFLICT DO NOTHING (createQueryBuilder() .insert().into()...execute)
 */
function makeAdjustChains(opts: {
  lockedLot: any;
  inScopeCount?: number;
  insertedRow: any;
  existingDuplicate?: any;
}) {
  const lotLockChain = {
    setLock: (jest.fn() as any).mockReturnThis(),
    where: (jest.fn() as any).mockReturnThis(),
    getOne: (jest.fn() as any).mockResolvedValue(opts.lockedLot),
  };
  const scopeChain = {
    innerJoin: (jest.fn() as any).mockReturnThis(),
    where: (jest.fn() as any).mockReturnThis(),
    andWhere: (jest.fn() as any).mockReturnThis(),
    getCount: (jest.fn() as any).mockResolvedValue(opts.inScopeCount ?? 1),
  };
  const insertChain = {
    insert: (jest.fn() as any).mockReturnThis(),
    into: (jest.fn() as any).mockReturnThis(),
    values: (jest.fn() as any).mockReturnThis(),
    orIgnore: (jest.fn() as any).mockReturnThis(),
    returning: (jest.fn() as any).mockReturnThis(),
    execute: (jest.fn() as any).mockResolvedValue({
      raw: opts.insertedRow ? [opts.insertedRow] : [],
    }),
  };
  return { lotLockChain, scopeChain, insertChain };
}

describe('InventoryService', () => {
  let lotRepo: ReturnType<typeof makeRepo>;
  let skuRepo: ReturnType<typeof makeRepo>;
  let configService: { get: ReturnType<typeof jest.fn> };
  let notificationsService: { createForAdmins: ReturnType<typeof jest.fn> };
  let mockManager: any;
  let dataSource: { transaction: jest.Mock };
  let service: InventoryService;

  beforeEach(() => {
    lotRepo = makeRepo();
    skuRepo = makeRepo();
    configService = { get: jest.fn().mockReturnValue(10) };
    notificationsService = { createForAdmins: jest.fn() };

    mockManager = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((..._args: any[]) => {
        // Accept either save(entity) or save(EntityClass, entity)
        const last = _args[_args.length - 1];
        return Promise.resolve(last);
      }),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation((cb: any) => cb(mockManager)),
    };

    service = new InventoryService(
      lotRepo as any,
      skuRepo as any,
      configService as any,
      notificationsService as any,
      dataSource as any,
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

  describe('adjustStock', () => {
    function arrangeManager(chains: ReturnType<typeof makeAdjustChains>) {
      const { lotLockChain, scopeChain, insertChain } = chains;
      // Calls in order:
      //   (1) createQueryBuilder(InventoryLot, 'lot')  → lock chain
      //   (2) createQueryBuilder(InventoryLot, 'lot')  → scope chain (only when storeId is set)
      //   (3) createQueryBuilder()                     → insert chain
      const queue: any[] = [lotLockChain, scopeChain, insertChain];
      mockManager.createQueryBuilder.mockImplementation((...args: any[]) => {
        // If no entity arg → it's the insert builder; otherwise dequeue.
        if (args.length === 0) return insertChain;
        return queue.shift() ?? lotLockChain;
      });
    }

    it('applies the delta exactly once on a fresh insert (winning path)', async () => {
      const lockedLot = { id: 'lot-1', sku_id: 'sku-1', quantity: 50 };
      const insertedRow = {
        id: 'adj-1',
        lot_id: 'lot-1',
        delta: 10,
        reason_code: 'restock',
        idempotency_key: 'idem-fresh',
        adjusted_by: 'u1',
      };
      arrangeManager(
        makeAdjustChains({ lockedLot, inScopeCount: 1, insertedRow }),
      );
      mockManager.findOne.mockResolvedValueOnce({ ...insertedRow });

      const result = await service.adjustStock(
        {
          lotId: 'lot-1',
          delta: 10,
          reasonCode: 'restock',
          idempotencyKey: 'idem-fresh',
        } as any,
        'u1',
        { id: 'u1', role: 'platform_admin' },
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(result.alreadyExisted).toBe(false);
      expect(result.adjustment.id).toBe('adj-1');
      // Lot save was called exactly once with the mutated quantity
      expect(mockManager.save).toHaveBeenCalledTimes(1);
      const savedArg = mockManager.save.mock.calls[0].slice(-1)[0];
      expect(savedArg.quantity).toBe(60);
    });

    it('returns existing adjustment without mutating quantity on duplicate idempotency key', async () => {
      const lockedLot = { id: 'lot-1', sku_id: 'sku-1', quantity: 50 };
      const existing = {
        id: 'adj-original',
        lot_id: 'lot-1',
        delta: 10,
        reason_code: 'restock',
        idempotency_key: 'idem-dup',
        adjusted_by: 'u1',
      };
      arrangeManager(
        makeAdjustChains({
          lockedLot,
          inScopeCount: 1,
          insertedRow: null, // ON CONFLICT DO NOTHING → 0 rows
        }),
      );
      mockManager.findOne.mockResolvedValueOnce(existing);

      const result = await service.adjustStock(
        {
          lotId: 'lot-1',
          delta: 10,
          reasonCode: 'restock',
          idempotencyKey: 'idem-dup',
        } as any,
        'u1',
        { id: 'u1', role: 'platform_admin' },
      );

      expect(result.alreadyExisted).toBe(true);
      expect(result.adjustment).toEqual(existing);
      // Critical: NO save was called for the lot — quantity must not drift
      expect(mockManager.save).not.toHaveBeenCalled();
      // Critical: notifications must not fire on the replay path
      expect(notificationsService.createForAdmins).not.toHaveBeenCalled();
    });

    it('serializes simulated concurrent duplicates into one delta application', async () => {
      // Simulate the race: N callers enter the transaction with the same
      // idempotencyKey. The mock insert below behaves like the real
      // `INSERT ... ON CONFLICT DO NOTHING` — the first caller to reach
      // execute() captures the key in a shared registry, and every
      // subsequent caller sees an empty `raw` and falls through to the
      // existing-adjustment path. Losers must NOT mutate quantity.
      const initialQty = 100;
      const delta = 5;
      const lot = { id: 'lot-1', sku_id: 'sku-1', quantity: initialQty };
      const winnerRow = {
        id: 'adj-winner',
        lot_id: 'lot-1',
        delta,
        reason_code: 'restock',
        idempotency_key: 'idem-race',
        adjusted_by: 'u1',
      };

      // Shared "DB-side" idempotency registry — atomic check-and-set in the
      // synchronous execute() body emulates the unique-constraint guarantee.
      const insertedKeys = new Set<string>();

      mockManager.createQueryBuilder.mockImplementation((...args: any[]) => {
        if (args.length === 0) {
          // Insert builder. Capture the key from .values() so execute() can
          // perform the atomic check.
          let capturedKey: string | undefined;
          const insertChain: any = {
            insert: jest.fn().mockReturnThis(),
            into: jest.fn().mockReturnThis(),
            values: jest.fn().mockImplementation((vals: any) => {
              capturedKey = vals.idempotency_key;
              return insertChain;
            }),
            orIgnore: jest.fn().mockReturnThis(),
            returning: jest.fn().mockReturnThis(),
            execute: jest.fn().mockImplementation(async () => {
              const isWinner = !!capturedKey && !insertedKeys.has(capturedKey);
              if (isWinner) insertedKeys.add(capturedKey as string);
              return { raw: isWinner ? [winnerRow] : [] };
            }),
          };
          return insertChain;
        }
        // Lot lock / scope check builder. Each call gets its own fresh lot
        // snapshot — concurrent callers shouldn't share mutable state.
        return {
          setLock: (jest.fn() as any).mockReturnThis(),
          innerJoin: (jest.fn() as any).mockReturnThis(),
          where: (jest.fn() as any).mockReturnThis(),
          andWhere: (jest.fn() as any).mockReturnThis(),
          getOne: (jest.fn() as any).mockResolvedValue({ ...lot }),
          getCount: (jest.fn() as any).mockResolvedValue(1),
        };
      });

      mockManager.findOne.mockImplementation(async () => winnerRow);
      mockManager.save.mockImplementation(async (..._args: any[]) => {
        const last = _args[_args.length - 1];
        return last;
      });

      const dto = {
        lotId: 'lot-1',
        delta,
        reasonCode: 'restock',
        idempotencyKey: 'idem-race',
      } as any;
      const user = { id: 'u1', role: 'platform_admin' };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.adjustStock(dto, 'u1', user)),
      );

      // Exactly one winner, four replays
      const winners = results.filter((r) => !r.alreadyExisted);
      const losers = results.filter((r) => r.alreadyExisted);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(4);

      // The lot was mutated exactly once (one save call)
      expect(mockManager.save).toHaveBeenCalledTimes(1);
      const savedArg = mockManager.save.mock.calls[0].slice(-1)[0];
      expect(savedArg.quantity).toBe(initialQty + delta);

      // Every response shares the winner's id
      for (const r of results) {
        expect(r.adjustment.id).toBe('adj-winner');
      }
    });

    it('throws NotFoundException when the locked lot does not exist', async () => {
      arrangeManager(
        makeAdjustChains({
          lockedLot: null,
          insertedRow: null,
        }),
      );

      await expect(
        service.adjustStock(
          {
            lotId: 'lot-missing',
            delta: 1,
            reasonCode: 'restock',
            idempotencyKey: 'idem-x',
          } as any,
          'u1',
          { id: 'u1', role: 'platform_admin' },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('blocks store_admin from adjusting a lot outside their store', async () => {
      arrangeManager(
        makeAdjustChains({
          lockedLot: { id: 'lot-x', sku_id: 'sku-foreign', quantity: 50 },
          inScopeCount: 0, // not in operator's store
          insertedRow: null,
        }),
      );

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
      expect(mockManager.save).not.toHaveBeenCalled();
    });
  });
});

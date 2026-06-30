import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing withRunRecord
vi.mock('@financial-pipeline/db', () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
    execute: vi.fn(),
  },
  runs: {},
  pending_materialization: {},
}));

// After mocking, import
const { db, runs } = await import('@financial-pipeline/db');
const { withRunRecord } = await import('./with-run-record.js');

const mockDb = db as {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  // Insert chain: .values().returning()
  const returningMock = vi.fn().mockResolvedValue([{ id: 42 }]);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
  mockDb.insert.mockReturnValue({ values: valuesMock });

  // Update chain: .set().where()
  const whereMock = vi.fn().mockResolvedValue([]);
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  mockDb.update.mockReturnValue({ set: setMock });

  // Transaction: executes callback
  mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      update: mockDb.update,
      insert: mockDb.insert,
      execute: vi.fn().mockResolvedValue([]),
    };
    await fn(tx);
  });
});

describe('withRunRecord', () => {
  it('marks run success when fn resolves', async () => {
    await withRunRecord('test-source', async () => ({ rowsWritten: 5 }));
    expect(mockDb.insert).toHaveBeenCalledTimes(2); // runs + pending_materialization
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('marks run failure and rethrows when fn throws', async () => {
    await expect(
      withRunRecord('test-source', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(mockDb.update).toHaveBeenCalled();
  });
});

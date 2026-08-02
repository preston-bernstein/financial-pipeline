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

// Stand in for pino: a plain object with spies instead of a real serializer, so failure/
// success log calls can be asserted on directly (what was passed in) rather than by
// re-parsing pino's newline-delimited JSON output. `.child()` returns a new stub carrying
// the merged bindings, mirroring pino's real child-logger semantics closely enough for
// these tests (real pino behavior itself is exercised by logger.test.ts).
function makeLoggerStub(bindings: Record<string, unknown> = {}) {
  return {
    bindings: () => bindings,
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn((childBindings: Record<string, unknown>) =>
      makeLoggerStub({ ...bindings, ...childBindings }),
    ),
  };
}

// Assigned before the dynamic import below so it exists by the time with-run-record.ts's
// module-level `createLogger('run-record')` call runs. Reused (not reassigned) across
// tests — `vi.clearAllMocks()` in beforeEach resets call history without touching the
// `child()` mock's implementation, so the stub stays wired correctly test-to-test.
const rootLogger = makeLoggerStub();
vi.mock('./logger.js', () => ({
  createLogger: () => rootLogger,
}));

// After mocking, import
const { db } = await import('@financial-pipeline/db');
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

  // Correlation: runs.id exists in the DB but was never logged (2026-08-01 audit finding).
  // withRunRecord now threads it into the fn via a child logger — assert the fn actually
  // receives the minted runId (42, per the returningMock above) as its correlation id.
  it('passes the minted runId to the wrapped fn, bound into a child logger', async () => {
    let seenRunId: number | undefined;
    let seenBindings: Record<string, unknown> | undefined;

    await withRunRecord('test-source', async ({ runId, log }) => {
      seenRunId = runId;
      seenBindings = log.bindings();
      return { rowsWritten: 1 };
    });

    expect(seenRunId).toBe(42);
    expect(seenBindings).toMatchObject({ run_id: 42, source: 'test-source' });
  });

  it('logs the completion line with run_id, event, outcome and rows_written', async () => {
    await withRunRecord('test-source', async () => ({ rowsWritten: 5 }));

    // The completion line is emitted on the run-scoped child logger, not the module root.
    const runLog = rootLogger.child.mock.results[0]!.value as ReturnType<typeof makeLoggerStub>;
    expect(runLog.info).toHaveBeenCalledWith(
      { event: 'run.completed', rows_written: 5, outcome: 'ok' },
      'run completed',
    );
  });

  // The audit found 9 messageless `log.error({ err })` call sites fleet-wide (unrelated to
  // this file, but withRunRecord's own failure line is the pattern every one of them should
  // now match): a stable literal msg, plus structured err_type/err_msg instead of a raw
  // Error object — logging the raw object risks dumping a stack trace (noise) and is an easy
  // place for a future call site to accidentally pass through raw content instead.
  it('logs a stable literal msg with structured err_type/err_msg on failure, never a raw err object', async () => {
    await expect(
      withRunRecord('test-source', async () => { throw new TypeError('bad input'); }),
    ).rejects.toThrow('bad input');

    const runLog = rootLogger.child.mock.results[0]!.value as ReturnType<typeof makeLoggerStub>;
    expect(runLog.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = runLog.error.mock.calls[0]!;
    expect(msg).toBe('run failed');
    expect(fields).toEqual({ event: 'run.failed', err_type: 'TypeError', err_msg: 'bad input' });
    expect(fields).not.toHaveProperty('err');
  });
});

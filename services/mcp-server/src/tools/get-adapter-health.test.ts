import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@financial-pipeline/db', () => ({ db: { execute: vi.fn() } }));
vi.mock('../config.js', () => ({
  loadConfig: () => ({
    staleness: { plaid_hours: 8, betterment_hours: 48, vanguard_hours: 48, fidelity_hours: 48 },
  }),
}));

const { db } = await import('@financial-pipeline/db');
const { getAdapterHealth } = await import('./get-adapter-health.js');

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

function parse(result: Awaited<ReturnType<typeof getAdapterHealth>>) {
  return JSON.parse(result.content[0]!.text) as Array<{ source: string; status: string; stale: boolean }>;
}

describe('getAdapterHealth — stale must reflect outcome, not just recency', () => {
  // The did-nothing-rule fix makes betterment/vanguard/fidelity throw (status='failure')
  // on a suspect scrape instead of silently succeeding with garbage data. with-run-record.ts
  // sets completed_at on failure too, so a naive recency-only staleness check would still
  // read this run as "fresh" even though it produced nothing usable — exactly the gap this
  // tool exists to close.
  it('reports stale=true for a recent run that failed, not just an old one', async () => {
    const recentButFailed = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    mockExecute.mockResolvedValueOnce([
      { source: 'betterment', status: 'failure', completed_at: recentButFailed, rows_written: null, error_message: 'suspect (all_zero_balance)' },
    ]);

    const health = parse(await getAdapterHealth());
    const betterment = health.find((h) => h.source === 'betterment')!;
    expect(betterment.status).toBe('failure');
    expect(betterment.stale).toBe(true);
  });

  it('reports stale=false only for a recent, successful run', async () => {
    const recentSuccess = new Date(Date.now() - 60_000).toISOString();
    mockExecute.mockResolvedValueOnce([
      { source: 'plaid', status: 'success', completed_at: recentSuccess, rows_written: 12, error_message: null },
    ]);

    const health = parse(await getAdapterHealth());
    const plaid = health.find((h) => h.source === 'plaid')!;
    expect(plaid.stale).toBe(false);
  });

  it('reports stale=true and status=never_run for a source with no runs row', async () => {
    mockExecute.mockResolvedValueOnce([]);
    const health = parse(await getAdapterHealth());
    const vanguard = health.find((h) => h.source === 'vanguard')!;
    expect(vanguard.status).toBe('never_run');
    expect(vanguard.stale).toBe(true);
  });
});

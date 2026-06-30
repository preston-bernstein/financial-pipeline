import { describe, it, expect } from 'vitest';
import { aggregateMonthly, computeNetWorth, isStale } from './compute.js';

describe('aggregateMonthly', () => {
  it('groups transactions by year-month', () => {
    const txs = [
      { date: '2026-06-10', amount: '50.00', llm_category: 'groceries', category: null },
      { date: '2026-06-20', amount: '30.00', llm_category: 'restaurants', category: null },
      { date: '2026-05-15', amount: '100.00', llm_category: null, category: 'shopping' },
    ];
    const result = aggregateMonthly(txs);
    expect(result).toHaveLength(2);
    const june = result.find(r => r.year === 2026 && r.month === 6)!;
    expect(june.total).toBe('80.00');
    expect(june.by_category['groceries']).toBe('50.00');
    expect(june.by_category['restaurants']).toBe('30.00');
    const may = result.find(r => r.year === 2026 && r.month === 5)!;
    expect(may.total).toBe('100.00');
    expect(may.by_category['shopping']).toBe('100.00');
  });

  it('prefers llm_category over category', () => {
    const txs = [{ date: '2026-06-01', amount: '20.00', llm_category: 'healthcare', category: 'medical' }];
    const result = aggregateMonthly(txs);
    expect(result[0]!.by_category['healthcare']).toBe('20.00');
    expect(result[0]!.by_category['medical']).toBeUndefined();
  });

  it('falls back to other when both categories are null', () => {
    const txs = [{ date: '2026-06-01', amount: '5.00', llm_category: null, category: null }];
    const result = aggregateMonthly(txs);
    expect(result[0]!.by_category['other']).toBe('5.00');
  });

  it('handles empty input', () => {
    expect(aggregateMonthly([])).toEqual([]);
  });

  it('handles credits (negative amounts)', () => {
    const txs = [
      { date: '2026-06-01', amount: '200.00', llm_category: 'groceries', category: null },
      { date: '2026-06-02', amount: '-50.00', llm_category: 'income', category: null },
    ];
    const result = aggregateMonthly(txs);
    expect(parseFloat(result[0]!.total)).toBeCloseTo(150.0);
  });
});

describe('computeNetWorth', () => {
  it('sums latest balance per account', () => {
    const older = new Date('2026-06-01');
    const newer = new Date('2026-06-15');
    const snapshots = [
      { source: 'betterment', account_id: 'safety-net', account_name: 'Safety Net', balance: '5000.00', currency: 'USD', captured_at: older },
      { source: 'betterment', account_id: 'safety-net', account_name: 'Safety Net', balance: '5100.00', currency: 'USD', captured_at: newer },
      { source: 'vanguard', account_id: 'brokerage', account_name: 'Brokerage', balance: '20000.00', currency: 'USD', captured_at: older },
    ];
    const result = computeNetWorth(snapshots);
    expect(result.total).toBeCloseTo(25100.0);
    expect(result.by_source['betterment']).toBeCloseTo(5100.0);
    expect(result.by_source['vanguard']).toBeCloseTo(20000.0);
  });

  it('returns zero for empty snapshots', () => {
    expect(computeNetWorth([]).total).toBe(0);
  });
});

describe('isStale', () => {
  it('returns true when lastAt is null', () => {
    expect(isStale(null, 8)).toBe(true);
  });

  it('returns true when age exceeds window', () => {
    const ninehours = new Date(Date.now() - 9 * 3_600_000);
    expect(isStale(ninehours, 8)).toBe(true);
  });

  it('returns false when within window', () => {
    const sevenhours = new Date(Date.now() - 7 * 3_600_000);
    expect(isStale(sevenhours, 8)).toBe(false);
  });
});

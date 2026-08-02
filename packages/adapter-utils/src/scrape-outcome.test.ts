import { describe, it, expect } from 'vitest';
import { classifyBalanceScrape } from './scrape-outcome.js';

describe('classifyBalanceScrape — the did-nothing rule for balance adapters', () => {
  it('treats a nonempty, nonzero scrape as ok', () => {
    expect(classifyBalanceScrape([1200.5, 340.0])).toEqual({ outcome: 'ok' });
  });

  it('treats a real mixed zero/nonzero result as ok (a fresh unfunded goal is legitimate)', () => {
    expect(classifyBalanceScrape([0, 5000])).toEqual({ outcome: 'ok' });
  });

  it('flags zero scraped rows as suspect (selectors/session likely broke)', () => {
    expect(classifyBalanceScrape([])).toEqual({ outcome: 'suspect', reason: 'empty_scrape' });
  });

  it('flags every-balance-zero as suspect even though rows were found', () => {
    expect(classifyBalanceScrape([0, 0, 0])).toEqual({ outcome: 'suspect', reason: 'all_zero_balance' });
  });

  it('does not flag a single real zero-balance goal', () => {
    expect(classifyBalanceScrape([0])).toEqual({ outcome: 'suspect', reason: 'all_zero_balance' });
    // Note: a lone goal really can be $0 (brand-new, unfunded) — but with only one data
    // point there is no way to distinguish that from a fully-broken balance selector, so
    // this case is deliberately conservative (flags rather than silently trusting a
    // single zero). Documented here rather than left to be rediscovered.
  });
});

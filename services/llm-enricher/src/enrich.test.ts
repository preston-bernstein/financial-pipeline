import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichBatch, PROMPT_VERSION } from './enrich.js';

const BROKER = 'http://broker:11436';
const MODEL = 'llama3.2:3b';

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ response }),
  }));
}

describe('enrichBatch', () => {
  it('maps valid categories from LLM response', async () => {
    mockFetch('[{"id":1,"category":"groceries"},{"id":2,"category":"restaurants"}]');
    const txs = [
      { id: 'tx1', description: 'KROGER', merchant_name: 'Kroger', amount: '45.00', category: null },
      { id: 'tx2', description: 'CHIPOTLE', merchant_name: 'Chipotle', amount: '15.00', category: null },
    ];
    const result = await enrichBatch(txs, BROKER, MODEL);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'tx1', llm_category: 'groceries' });
    expect(result[1]).toEqual({ id: 'tx2', llm_category: 'restaurants' });
  });

  it('falls back to other for unknown categories', async () => {
    mockFetch('[{"id":1,"category":"food_and_dining"}]');
    const txs = [
      { id: 'tx1', description: 'RANDOM', merchant_name: null, amount: '10.00', category: null },
    ];
    const result = await enrichBatch(txs, BROKER, MODEL);
    expect(result[0]!.llm_category).toBe('other');
  });

  it('returns empty array when broker errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const txs = [
      { id: 'tx1', description: 'AMAZON', merchant_name: 'Amazon', amount: '29.99', category: null },
    ];
    const result = await enrichBatch(txs, BROKER, MODEL);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when response is unparseable', async () => {
    mockFetch('Sorry, I cannot classify these transactions.');
    const txs = [
      { id: 'tx1', description: 'WALMART', merchant_name: 'Walmart', amount: '60.00', category: null },
    ];
    const result = await enrichBatch(txs, BROKER, MODEL);
    expect(result).toHaveLength(0);
  });

  it('handles empty input', async () => {
    const result = await enrichBatch([], BROKER, MODEL);
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('PROMPT_VERSION', () => {
  it('is defined and non-empty', () => {
    expect(PROMPT_VERSION).toBeTruthy();
  });
});

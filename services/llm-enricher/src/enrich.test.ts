import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichBatch, PROMPT_VERSION_L1, PROMPT_VERSION_L2, PROMPT_VERSION_L3 } from './enrich.js';
import type { RunpodConfig } from './enrich.js';

const BROKER = 'http://broker:11436';
const MODELS = { l1: 'qwen2.5:3b', l2: 'qwen2.5:7b' };
const MODELS_L3 = { ...MODELS, l3: 'Qwen/Qwen2.5-72B-Instruct' };
const RUNPOD: RunpodConfig = { baseUrl: 'https://api.runpod.ai/v2/abc123/openai/v1', apiKey: 'rp_test' };

beforeEach(() => vi.restoreAllMocks());

function mockFetch(...responses: string[]) {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    const response = responses[call++] ?? responses[responses.length - 1]!;
    return Promise.resolve({ ok: true, json: async () => ({ response }) });
  }));
}

function mockFetchError() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
}

const TX_KROGER = { id: 'tx1', description: 'KROGER', merchant_name: 'Kroger', amount: '45.00', category: null };
const TX_CHIPOTLE = { id: 'tx2', description: 'CHIPOTLE', merchant_name: 'Chipotle', amount: '15.00', category: null };
const TX_WEIRD = { id: 'tx3', description: 'XYZ HOLDINGS 8372', merchant_name: null, amount: '200.00', category: null };

describe('enrichBatch — cascade behaviour', () => {
  it('accepts L1 high-confidence results without calling L2', async () => {
    mockFetch('[{"id":1,"category":"groceries","conf":"high"},{"id":2,"category":"restaurants","conf":"high"}]');
    const result = await enrichBatch([TX_KROGER, TX_CHIPOTLE], BROKER, MODELS);

    expect(fetch).toHaveBeenCalledTimes(1); // only L1 batch
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'tx1', llm_category: 'groceries', llm_model: MODELS.l1, prompt_version: PROMPT_VERSION_L1 });
    expect(result[1]).toMatchObject({ id: 'tx2', llm_category: 'restaurants', llm_model: MODELS.l1, prompt_version: PROMPT_VERSION_L1 });
  });

  it('escalates low-confidence L1 results to L2', async () => {
    // L1 returns low conf for tx3; L2 classifies it
    mockFetch(
      '[{"id":1,"category":"other","conf":"low"}]',         // L1 response
      '{"category":"transfers"}',                            // L2 response for tx3
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ id: 'tx3', llm_category: 'transfers', llm_model: MODELS.l2, prompt_version: PROMPT_VERSION_L2 });
  });

  it('escalates med-confidence results to L2', async () => {
    mockFetch(
      '[{"id":1,"category":"groceries","conf":"med"}]',
      '{"category":"shopping"}',
    );
    const result = await enrichBatch([TX_KROGER], BROKER, MODELS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ llm_category: 'shopping', prompt_version: PROMPT_VERSION_L2 });
  });

  it('escalates high-conf "other" to L2', async () => {
    // High confidence "other" still gets a second look
    mockFetch(
      '[{"id":1,"category":"other","conf":"high"}]',
      '{"category":"entertainment"}',
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ llm_category: 'entertainment', prompt_version: PROMPT_VERSION_L2 });
  });

  it('mixed batch: some accepted at L1, some escalated to L2', async () => {
    mockFetch(
      '[{"id":1,"category":"groceries","conf":"high"},{"id":2,"category":"other","conf":"low"}]',
      '{"category":"transfers"}', // L2 for tx2
    );
    const result = await enrichBatch([TX_KROGER, TX_CHIPOTLE], BROKER, MODELS);

    expect(fetch).toHaveBeenCalledTimes(2);
    const groceries = result.find(r => r.id === 'tx1')!;
    const transfers = result.find(r => r.id === 'tx2')!;
    expect(groceries).toMatchObject({ llm_category: 'groceries', prompt_version: PROMPT_VERSION_L1 });
    expect(transfers).toMatchObject({ llm_category: 'transfers', prompt_version: PROMPT_VERSION_L2 });
  });

  it('falls back to "other" when L2 broker errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '[{"id":1,"category":"other","conf":"low"}]' }) })
      .mockResolvedValueOnce({ ok: false, status: 503 }),
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS);
    expect(result[0]).toMatchObject({ llm_category: 'other', prompt_version: PROMPT_VERSION_L2 });
  });

  it('escalates tx missing from L1 response entirely', async () => {
    // L1 only returns result for tx1, tx2 missing → escalate tx2
    mockFetch(
      '[{"id":1,"category":"groceries","conf":"high"}]', // tx2 absent
      '{"category":"restaurants"}',                       // L2 for tx2
    );
    const result = await enrichBatch([TX_KROGER, TX_CHIPOTLE], BROKER, MODELS);
    const chipotle = result.find(r => r.id === 'tx2')!;
    expect(chipotle).toMatchObject({ llm_category: 'restaurants', prompt_version: PROMPT_VERSION_L2 });
  });

  it('returns empty array for empty input without calling broker', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const result = await enrichBatch([], BROKER, MODELS);
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns empty when L1 broker is down and L2 called for all txs', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // L1 fails
      .mockResolvedValue({ ok: true, json: async () => ({ response: '{"category":"groceries"}' }) }), // L2 ok
    );
    const result = await enrichBatch([TX_KROGER], BROKER, MODELS);
    expect(result[0]).toMatchObject({ llm_category: 'groceries', prompt_version: PROMPT_VERSION_L2 });
  });
});

describe('enrichBatch — L3 RunPod escalation', () => {
  it('does not call L3 when L2 succeeds with a real category', async () => {
    mockFetch(
      '[{"id":1,"category":"other","conf":"low"}]', // L1: escalate
      '{"category":"shopping"}',                    // L2: classified → accept, no L3
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS_L3, RUNPOD);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ llm_category: 'shopping', prompt_version: PROMPT_VERSION_L2 });
  });

  it('escalates to L3 when L2 also returns "other"', async () => {
    // L3 response is OpenAI chat completions format
    const l3Response = JSON.stringify({
      choices: [{ message: { content: 'entertainment' } }],
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '[{"id":1,"category":"other","conf":"low"}]' }) }) // L1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '{"category":"other"}' }) })  // L2 → other
      .mockResolvedValueOnce({ ok: true, json: async () => JSON.parse(l3Response) }),                 // L3
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS_L3, RUNPOD);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result[0]).toMatchObject({ llm_category: 'entertainment', llm_model: MODELS_L3.l3, prompt_version: PROMPT_VERSION_L3 });
  });

  it('does not call RunPod when L3 model is not configured', async () => {
    mockFetch(
      '[{"id":1,"category":"other","conf":"low"}]',
      '{"category":"other"}', // L2 also other — but no L3 configured
    );
    // No l3 in models, no runpod config
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ llm_category: 'other', prompt_version: PROMPT_VERSION_L2 });
  });

  it('falls back to "other" when RunPod L3 errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '[{"id":1,"category":"other","conf":"low"}]' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '{"category":"other"}' }) })
      .mockResolvedValueOnce({ ok: false, status: 500 }), // L3 RunPod error
    );
    const result = await enrichBatch([TX_WEIRD], BROKER, MODELS_L3, RUNPOD);
    expect(result[0]).toMatchObject({ llm_category: 'other', prompt_version: PROMPT_VERSION_L3 });
  });

  it('sends correct Authorization header to RunPod', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '[{"id":1,"category":"other","conf":"low"}]' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: '{"category":"other"}' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'shopping' } }] }) });
    vi.stubGlobal('fetch', fetchMock);

    await enrichBatch([TX_WEIRD], BROKER, MODELS_L3, RUNPOD);

    const l3Call = fetchMock.mock.calls[2]!;
    expect(l3Call[0]).toContain('runpod.ai');
    const headers = l3Call[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${RUNPOD.apiKey}`);
  });
});

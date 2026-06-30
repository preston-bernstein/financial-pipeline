import { createLogger } from '@financial-pipeline/adapter-utils';
import { CATEGORY_LIST, isValidCategory, type Category } from './taxonomy.js';

const log = createLogger('llm-enricher');

export const PROMPT_VERSION = 'enrich-v1';

export interface TxToEnrich {
  id: string;
  description: string;
  merchant_name: string | null;
  amount: string;
  category: string | null;
}

export interface EnrichedTx {
  id: string;
  llm_category: Category;
}

const BATCH_SIZE = 30;

function buildPrompt(txs: TxToEnrich[]): string {
  const lines = txs.map((t, i) => {
    const merchant = t.merchant_name ? ` (${t.merchant_name})` : '';
    const amt = parseFloat(t.amount);
    const sign = amt >= 0 ? 'debit' : 'credit';
    return `${i + 1}. "${t.description}"${merchant} $${Math.abs(amt).toFixed(2)} ${sign}`;
  });

  return `Classify each transaction into exactly one of these categories: ${CATEGORY_LIST}

Rules:
- Use "income" for credits/deposits (negative amounts), payroll, tax refunds
- Use "transfers" for Zelle, Venmo P2P, wire transfers, ATM withdrawals
- Use "subscriptions" for recurring software, streaming, memberships
- Use "other" only when nothing else fits

Transactions:
${lines.join('\n')}

Reply with ONLY a JSON array of objects: [{"id": <1-based index>, "category": "<category>"}]
No explanation, no markdown, just the JSON array.`;
}

function parseBatchResponse(raw: string, txs: TxToEnrich[]): EnrichedTx[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: Array<{ id: number; category: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Array<{ id: number; category: string }>;
  } catch {
    log.warn({ raw }, 'failed to parse enricher response');
    return [];
  }

  const results: EnrichedTx[] = [];
  for (const item of parsed) {
    const tx = txs[item.id - 1];
    if (!tx) continue;
    const cat = item.category?.toLowerCase().trim();
    if (isValidCategory(cat)) {
      results.push({ id: tx.id, llm_category: cat });
    } else {
      results.push({ id: tx.id, llm_category: 'other' });
    }
  }
  return results;
}

export async function enrichBatch(
  txs: TxToEnrich[],
  brokerUrl: string,
  model: string,
): Promise<EnrichedTx[]> {
  const results: EnrichedTx[] = [];

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const chunk = txs.slice(i, i + BATCH_SIZE);
    const prompt = buildPrompt(chunk);

    try {
      const res = await fetch(`${brokerUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
      });

      if (!res.ok) {
        log.error({ status: res.status }, 'broker error');
        continue;
      }

      const data = await res.json() as { response?: string };
      const enriched = parseBatchResponse(data.response ?? '', chunk);
      results.push(...enriched);
      log.info({ chunk: i / BATCH_SIZE + 1, enriched: enriched.length }, 'batch enriched');
    } catch (err) {
      log.error({ err }, 'enrichment batch failed');
    }
  }

  return results;
}

import { createLogger } from '@financial-pipeline/adapter-utils';
import { CATEGORY_LIST, isValidCategory, type Category } from './taxonomy.js';

const log = createLogger('llm-enricher');

export const PROMPT_VERSION_L1 = 'enrich-v1-l1';
export const PROMPT_VERSION_L2 = 'enrich-v1-l2';
/** Backwards-compat alias used by --backfill reset logic */
export const PROMPT_VERSION = PROMPT_VERSION_L1;

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
  llm_model: string;
  prompt_version: string;
}

interface L1Result {
  id: string;
  llm_category: Category;
  conf: 'high' | 'med' | 'low';
}

const BATCH_SIZE = 30;

// ─── L1: fast batch pass ──────────────────────────────────────────────────────

function buildL1Prompt(txs: TxToEnrich[]): string {
  const lines = txs.map((t, i) => {
    const merchant = t.merchant_name ? ` (${t.merchant_name})` : '';
    const amt = parseFloat(t.amount);
    const sign = amt >= 0 ? 'debit' : 'credit';
    return `${i + 1}. "${t.description}"${merchant} $${Math.abs(amt).toFixed(2)} ${sign}`;
  });

  return `Classify each transaction into exactly one of: ${CATEGORY_LIST}

Rules:
- "income": credits/deposits, payroll, tax refunds (negative amounts)
- "transfers": Zelle, Venmo P2P, ATM, wire transfers
- "subscriptions": recurring software, streaming, memberships
- "other": only when nothing else fits — be conservative

For each item return: conf="high" (clear match), "med" (best guess), or "low" (no good match).

Transactions:
${lines.join('\n')}

Reply with ONLY a JSON array — no explanation, no markdown:
[{"id":<1-based>,"category":"<cat>","conf":"high|med|low"}]`;
}

function parseL1Response(raw: string, txs: TxToEnrich[]): L1Result[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: Array<{ id: number; category: string; conf?: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    log.warn({ raw }, 'failed to parse L1 response');
    return [];
  }

  const results: L1Result[] = [];
  for (const item of parsed) {
    const tx = txs[item.id - 1];
    if (!tx) continue;
    const cat = item.category?.toLowerCase().trim();
    const conf = (['high', 'med', 'low'] as const).find(c => c === item.conf) ?? 'low';
    results.push({
      id: tx.id,
      llm_category: isValidCategory(cat) ? cat : 'other',
      conf,
    });
  }
  return results;
}

async function runL1Batch(
  txs: TxToEnrich[],
  brokerUrl: string,
  model: string,
): Promise<L1Result[]> {
  const results: L1Result[] = [];

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const chunk = txs.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(`${brokerUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: buildL1Prompt(chunk), stream: false }),
      });
      if (!res.ok) { log.error({ status: res.status }, 'L1 broker error'); continue; }
      const data = await res.json() as { response?: string };
      results.push(...parseL1Response(data.response ?? '', chunk));
    } catch (err) {
      log.error({ err }, 'L1 batch failed');
    }
  }

  return results;
}

// ─── L2: careful single-tx pass ──────────────────────────────────────────────

function buildL2Prompt(tx: TxToEnrich): string {
  const merchant = tx.merchant_name ? ` (${tx.merchant_name})` : '';
  const amt = parseFloat(tx.amount);
  const sign = amt >= 0 ? 'debit' : 'credit';

  return `Classify this financial transaction into exactly one category.

Categories: ${CATEGORY_LIST}

Key rules:
- groceries: supermarkets, grocery stores, Whole Foods, Costco, ALDI, farmers markets
- restaurants: dining out, fast food, coffee shops, food delivery (DoorDash, UberEats)
- transportation: gas stations, Uber/Lyft, parking, transit, car maintenance
- utilities: electric, gas, water, internet, phone, trash
- healthcare: doctors, dentists, pharmacies, vision, therapy, health insurance
- entertainment: movies, concerts, bars, streaming services (Netflix, Spotify)
- shopping: Amazon, department stores, clothing, electronics, hardware
- housing: rent, mortgage, HOA fees, home improvement
- subscriptions: recurring software/SaaS, annual memberships, gym dues
- travel: flights, hotels, Airbnb, car rentals, vacation spending
- transfers: Zelle, Venmo, ACH transfers, ATM withdrawals, wire transfers
- income: payroll, direct deposit, tax refunds, dividends (typically credit/negative amount)
- education: tuition, textbooks, courses, school supplies
- personal_care: haircuts, gyms, spa, beauty, personal hygiene products
- other: only if truly nothing fits

Transaction: "${tx.description}"${merchant} $${Math.abs(amt).toFixed(2)} ${sign}

Reply with ONLY valid JSON: {"category":"<category>"}`;
}

async function runL2Single(
  tx: TxToEnrich,
  brokerUrl: string,
  model: string,
): Promise<Category> {
  try {
    const res = await fetch(`${brokerUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: buildL2Prompt(tx), stream: false }),
    });
    if (!res.ok) { log.error({ status: res.status, id: tx.id }, 'L2 broker error'); return 'other'; }
    const data = await res.json() as { response?: string };
    const raw = data.response ?? '';
    const jsonMatch = raw.match(/\{[^}]+\}/);
    if (!jsonMatch) return 'other';
    const parsed = JSON.parse(jsonMatch[0]) as { category?: string };
    const cat = parsed.category?.toLowerCase().trim();
    return isValidCategory(cat) ? cat : 'other';
  } catch (err) {
    log.error({ err, id: tx.id }, 'L2 single failed');
    return 'other';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function shouldEscalate(r: L1Result): boolean {
  // Escalate if confidence is not high, or if L1 landed on "other"
  // (L2's richer prompt may categorize what L1 gave up on)
  return r.conf !== 'high' || r.llm_category === 'other';
}

export async function enrichBatch(
  txs: TxToEnrich[],
  brokerUrl: string,
  models: { l1: string; l2: string },
): Promise<EnrichedTx[]> {
  if (txs.length === 0) return [];

  // L1 — fast batch pass
  const l1Results = await runL1Batch(txs, brokerUrl, models.l1);

  const accepted: EnrichedTx[] = [];
  const toEscalate: Array<{ tx: TxToEnrich }> = [];

  // Index txs by id for L2 lookup
  const txById = new Map(txs.map(t => [t.id, t]));

  for (const r of l1Results) {
    if (shouldEscalate(r)) {
      const tx = txById.get(r.id);
      if (tx) toEscalate.push({ tx });
    } else {
      accepted.push({ id: r.id, llm_category: r.llm_category, llm_model: models.l1, prompt_version: PROMPT_VERSION_L1 });
    }
  }

  // Any tx that got no L1 result at all also escalates
  const l1Ids = new Set(l1Results.map(r => r.id));
  for (const tx of txs) {
    if (!l1Ids.has(tx.id)) toEscalate.push({ tx });
  }

  log.info({ total: txs.length, l1_accepted: accepted.length, l2_escalated: toEscalate.length }, 'cascade split');

  // L2 — careful single-tx pass for escalated items
  for (const { tx } of toEscalate) {
    const cat = await runL2Single(tx, brokerUrl, models.l2);
    accepted.push({ id: tx.id, llm_category: cat, llm_model: models.l2, prompt_version: PROMPT_VERSION_L2 });
  }

  return accepted;
}

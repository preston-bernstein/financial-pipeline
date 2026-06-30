import 'dotenv/config';
import { isNull, eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { createLogger, sendNtfyAlert } from '@financial-pipeline/adapter-utils';
import { db, transactions } from '@financial-pipeline/db';
import { enrichBatch, PROMPT_VERSION, type RunpodConfig } from './enrich.js';

const log = createLogger('llm-enricher');

const BROKER_URL = process.env.OLLAMA_BROKER_URL;
const MODEL_L1 = process.env.ENRICHER_MODEL    ?? 'qwen2.5:3b';
const MODEL_L2 = process.env.ENRICHER_MODEL_L2 ?? 'qwen2.5:7b';
const MODEL_L3 = process.env.ENRICHER_MODEL_L3;          // e.g. Qwen/Qwen2.5-72B-Instruct
const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;      // https://api.runpod.ai/v2/<id>/openai/v1
const RUNPOD_API_KEY  = process.env.RUNPOD_API_KEY;

function runpodConfig(): RunpodConfig | undefined {
  if (RUNPOD_BASE_URL && RUNPOD_API_KEY) return { baseUrl: RUNPOD_BASE_URL, apiKey: RUNPOD_API_KEY };
  return undefined;
}

async function run(): Promise<void> {
  if (!BROKER_URL) {
    log.warn('OLLAMA_BROKER_URL not set — skipping enrichment');
    return;
  }

  const pending = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      merchant_name: transactions.merchant_name,
      amount: transactions.amount,
      category: transactions.category,
    })
    .from(transactions)
    .where(isNull(transactions.llm_category));

  if (pending.length === 0) {
    log.info('no unenriched transactions');
    return;
  }

  const rp = runpodConfig();
  log.info({ count: pending.length, l1: MODEL_L1, l2: MODEL_L2, l3: MODEL_L3 ?? 'disabled', runpod: !!rp }, 'enriching');

  const enriched = await enrichBatch(
    pending,
    BROKER_URL,
    { l1: MODEL_L1, l2: MODEL_L2, l3: MODEL_L3 },
    rp,
  );

  for (const e of enriched) {
    await db
      .update(transactions)
      .set({ llm_category: e.llm_category, llm_model: e.llm_model, prompt_version: e.prompt_version })
      .where(eq(transactions.id, e.id));
  }

  const byLevel = enriched.reduce<Record<string, number>>((acc, e) => {
    acc[e.prompt_version] = (acc[e.prompt_version] ?? 0) + 1;
    return acc;
  }, {});
  log.info({ enriched: enriched.length, by_level: byLevel }, 'enrichment complete');
}

async function backfill(): Promise<void> {
  log.info('resetting llm_category for full backfill');
  await db.update(transactions).set({ llm_category: null, llm_model: null, prompt_version: null });
  await run();
}

if (process.argv.includes('--backfill')) {
  await backfill().catch(err => { log.error({ err }); process.exit(1); });
  process.exit(0);
}

if (process.argv.includes('--run-now')) {
  await run().catch(err => { log.error({ err }); process.exit(1); });
  process.exit(0);
}

new Cron('30 */4 * * *', () => {
  run().catch(async (err) => {
    log.error({ err }, 'cron run failed');
    await sendNtfyAlert(`llm-enricher failed: ${err}`, { title: 'financial-pipeline', priority: 'default' });
  });
});

log.info(`llm-enricher scheduled, l1=${MODEL_L1} l2=${MODEL_L2} l3=${MODEL_L3 ?? 'disabled'}`);

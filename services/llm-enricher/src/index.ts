import 'dotenv/config';
import { isNull, eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { createLogger, sendNtfyAlert } from '@financial-pipeline/adapter-utils';
import { db, transactions } from '@financial-pipeline/db';
import { enrichBatch, PROMPT_VERSION } from './enrich.js';

const log = createLogger('llm-enricher');

const BROKER_URL = process.env.OLLAMA_BROKER_URL;
const MODEL = process.env.ENRICHER_MODEL ?? 'llama3.2:3b';

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

  log.info({ count: pending.length }, 'enriching transactions');

  const enriched = await enrichBatch(pending, BROKER_URL, MODEL);

  for (const e of enriched) {
    await db
      .update(transactions)
      .set({ llm_category: e.llm_category, llm_model: MODEL, prompt_version: PROMPT_VERSION })
      .where(eq(transactions.id, e.id));
  }

  log.info({ enriched: enriched.length }, 'enrichment complete');
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

// Run every 4h, offset by 30 min from plaid-tap
new Cron('30 */4 * * *', () => {
  run().catch(async (err) => {
    log.error({ err }, 'cron run failed');
    await sendNtfyAlert(`llm-enricher failed: ${err}`, { title: 'financial-pipeline', priority: 'default' });
  });
});

log.info(`llm-enricher scheduled (every 4h+30m), model=${MODEL}`);

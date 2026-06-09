import 'dotenv/config';
import Database from 'better-sqlite3';
import { Cron } from 'croner';
import { withRunRecord, createLogger } from '@financial-pipeline/adapter-utils';
import { db, transactions } from '@financial-pipeline/db';

const log = createLogger('fungible-tap');
const FUNGIBLE_DB_PATH = process.env.FUNGIBLE_DB_PATH!;

async function run(): Promise<void> {
  await withRunRecord('fungible', async () => {
    const fungible = new Database(FUNGIBLE_DB_PATH, { readonly: true });
    let rowsWritten = 0;

    try {
      // TODO: query Fungible's transactions table, map to canonical schema, upsert
      // Verify Fungible's actual schema before implementing (sqlite3 .schema in the container)
      // const rows = fungible.prepare('SELECT * FROM transactions WHERE date > ?').all(lastRunDate);
      // rowsWritten = await upsertTransactions(db, rows);
    } finally {
      fungible.close();
    }

    return { rowsWritten };
  });
}

// every 4 hours per ADR 0008
new Cron('0 */4 * * *', () => { run().catch((err) => log.error({ err }, 'cron run failed')); });
log.info('fungible-tap scheduled (every 4h)');

if (process.argv.includes('--run-now')) run().catch((err) => { log.error({ err }); process.exit(1); });

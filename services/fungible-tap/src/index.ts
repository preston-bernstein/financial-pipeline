import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import { Cron } from 'croner';
import { withRunRecord, createLogger } from '@financial-pipeline/adapter-utils';
import { db, transactions } from '@financial-pipeline/db';

const log = createLogger('fungible-tap');

interface FungibleRow {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  description: string;
  merchant_name: string | null;
  category: string | null;
  pending: number; // 0 | 1
}

async function run(): Promise<void> {
  await withRunRecord('fungible', async () => {
    const fungible = new DatabaseSync(process.env.FUNGIBLE_DB_PATH!, { open: true });
    let rowsWritten = 0;

    try {
      // rolling 90-day window; upsert so manual_category / display_name edits in Fungible stay current
      const rows = fungible.prepare(`
        SELECT
          t.id,
          t.account_id,
          t.date,
          t.amount,
          COALESCE(t.display_name, t.name) AS description,
          t.merchant_name,
          COALESCE(t.manual_category, t.category) AS category,
          t.pending
        FROM transactions t
        WHERE t.ignored = 0
          AND t.date >= date('now', '-90 days')
        ORDER BY t.date DESC
      `).all() as unknown as FungibleRow[];

      log.info({ count: rows.length }, 'fetched from fungible');
      if (rows.length === 0) return { rowsWritten: 0 };

      const canonical = rows.map((r) => ({
        id: r.id,
        account_id: r.account_id,
        // Fungible/Plaid convention: positive = expense, negative = income — preserve as-is
        amount: r.amount.toFixed(2),
        currency: 'USD' as const,
        date: r.date,
        description: r.description,
        merchant_name: r.merchant_name ?? null,
        category: r.category ?? null,
        pending: r.pending === 1,
        source: 'plaid' as const,
      }));

      // batch in chunks of 500 to stay within Postgres parameter limits
      const CHUNK = 500;
      for (let i = 0; i < canonical.length; i += CHUNK) {
        await db
          .insert(transactions)
          .values(canonical.slice(i, i + CHUNK))
          .onConflictDoUpdate({
            target: transactions.id,
            set: {
              description: sql`excluded.description`,
              merchant_name: sql`excluded.merchant_name`,
              category: sql`excluded.category`,
              pending: sql`excluded.pending`,
            },
          });
      }

      rowsWritten = canonical.length;
    } finally {
      fungible.close();
    }

    return { rowsWritten };
  });
}

// every 4 hours per ADR 0008
new Cron('0 */4 * * *', () => {
  run().catch((err) => log.error({ err }, 'cron run failed'));
});
log.info('fungible-tap scheduled (every 4h)');

if (process.argv.includes('--run-now')) run().catch((err) => { log.error({ err }); process.exit(1); });

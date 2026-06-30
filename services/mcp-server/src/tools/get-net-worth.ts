import { sql } from 'drizzle-orm';
import { db } from '@financial-pipeline/db';

export async function getNetWorth() {
  // DISTINCT ON picks the most recent snapshot per (source, account_id)
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (source, account_id)
      source, account_id, account_name, balance, currency, captured_at
    FROM snapshots
    ORDER BY source, account_id, captured_at DESC
  `);

  const accounts = rows as Array<{
    source: string;
    account_id: string;
    account_name: string;
    balance: string;
    currency: string;
    captured_at: string;
  }>;

  const total = accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0);
  const by_source: Record<string, number> = {};
  for (const a of accounts) {
    by_source[a.source] = (by_source[a.source] ?? 0) + parseFloat(a.balance);
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ total: total.toFixed(2), by_source, accounts }),
    }],
  };
}

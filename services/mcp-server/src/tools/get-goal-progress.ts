import { sql } from 'drizzle-orm';
import { db } from '@financial-pipeline/db';
import { loadConfig } from '../config.js';

export async function getGoalProgress() {
  const config = loadConfig();
  const windowHours = config.staleness.betterment_hours;

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (account_id)
      account_id, account_name, balance, currency, metadata, captured_at
    FROM snapshots
    WHERE source = 'betterment'
    ORDER BY account_id, captured_at DESC
  `);

  const goals = rows as Array<{
    account_id: string;
    account_name: string;
    balance: string;
    currency: string;
    metadata: unknown;
    captured_at: string;
  }>;

  const stale = goals.length === 0
    || (Date.now() - new Date(goals[0]!.captured_at).getTime()) > windowHours * 3_600_000;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ stale, goals }),
    }],
  };
}

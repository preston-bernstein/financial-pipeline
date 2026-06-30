import { sql } from 'drizzle-orm';
import { db } from '@financial-pipeline/db';
import { loadConfig } from '../config.js';

const SOURCES = ['plaid', 'betterment', 'vanguard', 'fidelity'] as const;

export async function getAdapterHealth() {
  const config = loadConfig();

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (source)
      source, status, completed_at, rows_written, error_message
    FROM runs
    ORDER BY source, started_at DESC
  `);

  const lastRuns = rows as Array<{
    source: string;
    status: string;
    completed_at: string | null;
    rows_written: number | null;
    error_message: string | null;
  }>;

  const bySource = Object.fromEntries(lastRuns.map(r => [r.source, r]));

  const stalenessHours: Record<string, number> = {
    plaid: config.staleness.plaid_hours,
    betterment: config.staleness.betterment_hours,
    vanguard: config.staleness.vanguard_hours,
    fidelity: config.staleness.fidelity_hours,
  };

  const health = SOURCES.map(source => {
    const run = bySource[source];
    const windowHours = stalenessHours[source] ?? 48;
    const lastAt = run?.completed_at ? new Date(run.completed_at) : null;
    const stale = !lastAt || (Date.now() - lastAt.getTime()) > windowHours * 3_600_000;

    return {
      source,
      status: run?.status ?? 'never_run',
      last_completed: run?.completed_at ?? null,
      rows_written: run?.rows_written ?? null,
      error_message: run?.error_message ?? null,
      stale,
      staleness_window_hours: windowHours,
    };
  });

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(health) }],
  };
}

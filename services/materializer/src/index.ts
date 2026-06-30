import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createLogger, sendNtfyAlert } from '@financial-pipeline/adapter-utils';
import {
  db,
  monthly_spending,
  pending_materialization,
  transactions,
  snapshots,
  journal_entries,
  buildDbUrl,
} from '@financial-pipeline/db';
import { aggregateMonthly, computeNetWorth } from './compute.js';
import { generateJournalEntry, currentMonthKey, journalModel } from './journal.js';

const log = createLogger('materializer');

async function materialize(): Promise<void> {
  const pending = await db
    .select({ id: pending_materialization.id })
    .from(pending_materialization)
    .where(eq(pending_materialization.processed, false));

  if (pending.length === 0) return;

  const ids = pending.map((r) => r.id);
  log.info({ ids }, 'materialization started');

  try {
    // 1. Aggregate monthly spending from all settled transactions
    const txRows = await db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        llm_category: transactions.llm_category,
        category: transactions.category,
      })
      .from(transactions)
      .where(eq(transactions.pending, false));

    const aggregates = aggregateMonthly(txRows.map(r => ({
      date: r.date,
      amount: r.amount,
      llm_category: r.llm_category,
      category: r.category,
    })));

    for (const agg of aggregates) {
      await db
        .insert(monthly_spending)
        .values({
          year: agg.year,
          month: agg.month,
          total: agg.total,
          by_category: agg.by_category,
        })
        .onConflictDoUpdate({
          target: [monthly_spending.year, monthly_spending.month],
          set: {
            total: sql`excluded.total`,
            by_category: sql`excluded.by_category`,
            computed_at: sql`now()`,
          },
        });
    }

    log.info({ months: aggregates.length }, 'monthly_spending upserted');

    // 2. Mark pending rows processed
    await db
      .update(pending_materialization)
      .set({ processed: true })
      .where(inArray(pending_materialization.id, ids));

    log.info({ ids }, 'materialization complete');

    // 3. Maybe generate/refresh the current month's journal entry
    await maybeGenerateJournal();
  } catch (err) {
    log.error({ err, ids }, 'materialization failed');
    await sendNtfyAlert(`materializer failed: ${err}`, { title: 'financial-pipeline', priority: 'high' });
  }
}

async function maybeGenerateJournal(): Promise<void> {
  const monthKey = currentMonthKey();

  const existing = await db
    .select({ generated_at: journal_entries.generated_at })
    .from(journal_entries)
    .where(eq(journal_entries.month_key, monthKey))
    .limit(1);

  if (existing.length > 0) {
    const age = Date.now() - existing[0]!.generated_at.getTime();
    if (age < 24 * 3_600_000) return; // regenerate at most once per day
  }

  // Gather context
  const snapshotRows = await db.select({
    source: snapshots.source,
    account_id: snapshots.account_id,
    account_name: snapshots.account_name,
    balance: snapshots.balance,
    currency: snapshots.currency,
    captured_at: snapshots.captured_at,
  }).from(snapshots);

  const nwResult = computeNetWorth(snapshotRows.map(r => ({ ...r })));

  // Previous month net worth for delta
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevSnapshotRows = snapshotRows.filter(r => r.captured_at < firstOfMonth);
  const prevNwResult = prevSnapshotRows.length > 0
    ? computeNetWorth(prevSnapshotRows.map(r => ({ ...r })))
    : null;

  // Current month spending
  const currMonth = await db
    .select({ total: monthly_spending.total, by_category: monthly_spending.by_category })
    .from(monthly_spending)
    .where(
      sql`${monthly_spending.year} = ${now.getFullYear()} AND ${monthly_spending.month} = ${now.getMonth() + 1}`,
    )
    .limit(1);

  const monthlyTotal = currMonth.length > 0 ? parseFloat(currMonth[0]!.total) : 0;
  const byCategory = (currMonth[0]?.by_category as Record<string, string> | null) ?? {};

  const goalProgress = snapshotRows
    .filter(s => s.source === 'betterment')
    .map(s => ({ name: s.account_name, balance: parseFloat(s.balance) }));

  const monthLabel = new Date(now.getFullYear(), now.getMonth(), 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const content = await generateJournalEntry({
    monthLabel,
    netWorth: nwResult.total,
    prevNetWorth: prevNwResult?.total ?? null,
    monthlyTotal,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [k, parseFloat(v)]),
    ),
    goalProgress,
  });

  if (!content) return;

  await db
    .insert(journal_entries)
    .values({ month_key: monthKey, content, model: journalModel() })
    .onConflictDoUpdate({
      target: journal_entries.month_key,
      set: {
        content: sql`excluded.content`,
        model: sql`excluded.model`,
        generated_at: sql`now()`,
      },
    });

  log.info({ monthKey }, 'journal entry upserted');
}

// Cold-start drain: process any rows that arrived while we were down
await materialize();

// LISTEN for NOTIFY from adapters
const pgSql = postgres(buildDbUrl());

await pgSql.listen('materialization_requested', async (source) => {
  log.info({ source }, 'NOTIFY received');
  await materialize();
});

log.info('materializer listening for NOTIFY materialization_requested');

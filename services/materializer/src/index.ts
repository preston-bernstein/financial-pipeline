import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { createLogger } from '@financial-pipeline/adapter-utils';
import { db, monthly_spending, pending_materialization, buildDbUrl } from '@financial-pipeline/db';

const log = createLogger('materializer');

async function materialize(): Promise<void> {
  // claim pending rows before computing so concurrent NOTIFY calls don't double-process
  const pending = await db
    .select({ id: pending_materialization.id })
    .from(pending_materialization)
    .where(eq(pending_materialization.processed, false));

  if (pending.length === 0) return;

  const ids = pending.map((r) => r.id);
  log.info({ ids }, 'materialization started');

  try {
    // TODO: compute monthly_spending from transactions
    // TODO: compute net_worth from latest snapshots per source
    // TODO: compute goal_progress from betterment snapshots
    // TODO: compute derived_ceiling from config + savings outflows

    await db.update(pending_materialization)
      .set({ processed: true })
      .where(inArray(pending_materialization.id, ids));

    log.info({ ids }, 'materialization complete');
  } catch (err) {
    log.error({ err, ids }, 'materialization failed');
  }
}

// LISTEN for NOTIFY from adapters (ADR 0014)
const sql = postgres(buildDbUrl());

await sql.listen('materialization_requested', async (source) => {
  log.info({ source }, 'NOTIFY received');
  await materialize();
});

log.info('materializer listening for NOTIFY materialization_requested');

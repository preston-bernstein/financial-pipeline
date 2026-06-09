import { eq, sql } from 'drizzle-orm';
import { db, runs, pending_materialization } from '@financial-pipeline/db';
import { createLogger } from './logger.js';

const log = createLogger('run-record');

export async function withRunRecord(
  source: string,
  fn: () => Promise<{ rowsWritten: number }>
): Promise<void> {
  const [{ id: runId }] = await db.insert(runs).values({
    source,
    started_at: new Date(),
    status: 'running',
  }).returning({ id: runs.id });

  try {
    const { rowsWritten } = await fn();

    await db.transaction(async (tx) => {
      await tx.update(runs)
        .set({ status: 'success', completed_at: new Date(), rows_written: rowsWritten })
        .where(eq(runs.id, runId));

      await tx.insert(pending_materialization).values({ triggered_by: source });

      // NOTIFY fires inside the transaction so materializer only sees it after commit
      await tx.execute(sql`SELECT pg_notify('materialization_requested', ${source})`);
    });

    log.info({ source, rowsWritten }, 'run completed');
  } catch (err) {
    await db.update(runs)
      .set({ status: 'failure', completed_at: new Date(), error_message: String(err) })
      .where(eq(runs.id, runId));

    log.error({ source, err }, 'run failed');
    throw err;
  }
}

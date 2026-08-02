import { eq, sql } from 'drizzle-orm';
import { db, runs, pending_materialization } from '@financial-pipeline/db';
import { createLogger, type Logger } from './logger.js';
import { errFields } from './err-fields.js';

const log = createLogger('run-record');

export interface RunContext {
  /** `runs.id` for this execution — the contract's correlation id (CONVENTIONS.md §18).
   *  Threaded via `log` below rather than left to the caller to attach by hand. */
  runId: number;
  /** Child logger pre-bound with `run_id` and `source` — use this inside the wrapped fn
   *  so every line from this run, not just withRunRecord's own, is correlatable. */
  log: Logger;
}

export async function withRunRecord(
  source: string,
  fn: (ctx: RunContext) => Promise<{ rowsWritten: number }>
): Promise<void> {
  const [{ id: runId }] = await db.insert(runs).values({
    source,
    started_at: new Date(),
    status: 'running',
  }).returning({ id: runs.id });

  const runLog = log.child({ run_id: runId, source });

  try {
    const { rowsWritten } = await fn({ runId, log: runLog });

    await db.transaction(async (tx) => {
      await tx.update(runs)
        .set({ status: 'success', completed_at: new Date(), rows_written: rowsWritten })
        .where(eq(runs.id, runId));

      await tx.insert(pending_materialization).values({ triggered_by: source });

      // NOTIFY fires inside the transaction so materializer only sees it after commit
      await tx.execute(sql`SELECT pg_notify('materialization_requested', ${source})`);
    });

    runLog.info({ event: 'run.completed', rows_written: rowsWritten, outcome: 'ok' }, 'run completed');
  } catch (err) {
    await db.update(runs)
      .set({ status: 'failure', completed_at: new Date(), error_message: String(err) })
      .where(eq(runs.id, runId));

    runLog.error({ event: 'run.failed', ...errFields(err) }, 'run failed');
    throw err;
  }
}

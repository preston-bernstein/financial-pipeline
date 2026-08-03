import { sql } from 'drizzle-orm';
import { db } from '@financial-pipeline/db';
import { loadAuthToken } from './auth.js';

// A payload-free Prometheus text exporter, computed straight from Postgres rather than
// from in-process counters. Two reasons this beats instrumenting each of the six other
// long-lived containers directly:
//   1. Every number here is already a column this repo's own runs/transactions/
//      pending_materialization tables track — this module is `db-health.sh`
//      (.claude/skills/financial-pipeline-diagnostics-and-tooling/scripts/db-health.sh)
//      ported into a scrape target, per the 2026-08-01 audit's recommended fix.
//   2. It survives a container restart. An in-process gauge for "last run timestamp"
//      resets to absent the moment its container restarts — exactly the false-staleness
//      failure mode this section exists to prevent. Recomputing from Postgres each scrape
//      makes every series here durable across deploys.
//
// Every label below is a closed, low-cardinality enum (`source`: plaid/betterment/
// vanguard/fidelity; `status`: running/success/failure; `tier`: enrich-v1-l1/l2/l3).
// Nothing here is derived from transaction content — no account id, merchant name,
// description, or dollar amount ever appears in a metric name or label value.

interface RunStatusCount {
  source: string;
  status: string;
  n: string;
}

interface LastRun {
  source: string;
  status: string;
  completed_at: string | null;
}

interface EnrichTier {
  prompt_version: string;
  n: string;
}

interface ScalarCount {
  n: string;
}

function renderGauge(name: string, help: string, samples: Array<{ labels: Record<string, string>; value: number }>): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  for (const { labels, value } of samples) {
    lines.push(`${name}${renderLabels(labels)} ${value}`);
  }
  return lines.join('\n');
}

function renderCounter(name: string, help: string, samples: Array<{ labels: Record<string, string>; value: number }>): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const { labels, value } of samples) {
    lines.push(`${name}${renderLabels(labels)} ${value}`);
  }
  return lines.join('\n');
}

function renderLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(',')}}`;
}

export async function renderMetrics(): Promise<string> {
  const [
    runStatusCounts,
    lastRuns,
    lastSuccessRuns,
    enrichTiers,
    unenriched,
    materializationBacklog,
    stuckRunning,
  ] = await Promise.all([
    // finpipe_run_outcome_total{source,status} — cumulative historical count. Recomputed
    // in full each scrape, which is what makes this correct as a Prometheus counter even
    // though it's not incremented in-process: the true cumulative total only grows as more
    // rows land in `runs`, so a fresh COUNT(*) each time behaves exactly like a counter.
    db.execute(sql`
      SELECT source, status, count(*)::text AS n
      FROM runs
      GROUP BY source, status
    `),
    // finpipe_last_run_timestamp_seconds{source} — latest attempt regardless of outcome.
    db.execute(sql`
      SELECT DISTINCT ON (source) source, status, completed_at
      FROM runs
      WHERE completed_at IS NOT NULL
      ORDER BY source, started_at DESC
    `),
    // finpipe_last_success_timestamp_seconds{source} — latest run that actually succeeded;
    // this is the field a staleness alert should key off, not "last attempt."
    db.execute(sql`
      SELECT DISTINCT ON (source) source, status, completed_at
      FROM runs
      WHERE status = 'success'
      ORDER BY source, started_at DESC
    `),
    // finpipe_enrichment_tier_total{tier} — the enrichment cascade tier distribution.
    db.execute(sql`
      SELECT prompt_version, count(*)::text AS n
      FROM transactions
      WHERE prompt_version IS NOT NULL
      GROUP BY prompt_version
    `),
    db.execute(sql`SELECT count(*)::text AS n FROM transactions WHERE llm_category IS NULL`),
    db.execute(sql`SELECT count(*)::text AS n FROM pending_materialization WHERE processed = false`),
    db.execute(sql`SELECT count(*)::text AS n FROM runs WHERE status = 'running' AND started_at < now() - interval '2 hours'`),
  ]);

  const runOutcomeSamples = (runStatusCounts as unknown as RunStatusCount[]).map((r) => ({
    labels: { source: r.source, status: r.status },
    value: Number(r.n),
  }));

  const lastRunSamples = (lastRuns as unknown as LastRun[])
    .filter((r) => r.completed_at)
    .map((r) => ({
      labels: { source: r.source },
      value: Math.floor(new Date(r.completed_at!).getTime() / 1000),
    }));

  const lastSuccessSamples = (lastSuccessRuns as unknown as LastRun[])
    .filter((r) => r.completed_at)
    .map((r) => ({
      labels: { source: r.source },
      value: Math.floor(new Date(r.completed_at!).getTime() / 1000),
    }));

  // finpipe_work_quantity{source} — rows_written from the latest run per source (the
  // did-nothing rule's work-quantity field, exported per §18).
  const lastWithRows = await db.execute(sql`
    SELECT DISTINCT ON (source) source, rows_written
    FROM runs
    WHERE rows_written IS NOT NULL
    ORDER BY source, started_at DESC
  `);
  const workQuantitySamples = (lastWithRows as unknown as Array<{ source: string; rows_written: number }>).map((r) => ({
    labels: { source: r.source },
    value: r.rows_written,
  }));

  const enrichTierSamples = (enrichTiers as unknown as EnrichTier[]).map((r) => ({
    labels: { tier: r.prompt_version },
    value: Number(r.n),
  }));

  const unenrichedValue = Number((unenriched as unknown as ScalarCount[])[0]?.n ?? '0');
  const backlogValue = Number((materializationBacklog as unknown as ScalarCount[])[0]?.n ?? '0');
  const stuckValue = Number((stuckRunning as unknown as ScalarCount[])[0]?.n ?? '0');

  return [
    renderCounter(
      'finpipe_run_outcome_total',
      'Cumulative adapter/tap run outcomes by source and status (running|success|failure)',
      runOutcomeSamples,
    ),
    renderGauge(
      'finpipe_last_run_timestamp_seconds',
      'Unix timestamp of the most recently completed run per source, any outcome',
      lastRunSamples,
    ),
    renderGauge(
      'finpipe_last_success_timestamp_seconds',
      'Unix timestamp of the most recent successful run per source',
      lastSuccessSamples,
    ),
    renderGauge(
      'finpipe_work_quantity',
      'rows_written on the most recent run per source (the did-nothing rule work-quantity field)',
      workQuantitySamples,
    ),
    renderCounter(
      'finpipe_enrichment_tier_total',
      'Cumulative transactions enriched per cascade tier (enrich-v1-l1|l2|l3)',
      enrichTierSamples,
    ),
    renderGauge(
      'finpipe_unenriched_transactions',
      'Settled transactions with no llm_category yet — enrichment backlog',
      [{ labels: {}, value: unenrichedValue }],
    ),
    renderGauge(
      'finpipe_materialization_backlog',
      'pending_materialization rows not yet processed',
      [{ labels: {}, value: backlogValue }],
    ),
    renderGauge(
      'finpipe_runs_stuck_running',
      'runs rows stuck in status=running for over 2 hours (orphaned by an unclean restart)',
      [{ labels: {}, value: stuckValue }],
    ),
    // finpipe_mcp_auth_enabled — a security POSTURE check, not a PII leak: 1 if
    // MCP_AUTH_TOKEN (or the docker secret) is configured and /mcp is bearer-gated,
    // 0 if the server is running open. Re-derived from the same loadAuthToken() the
    // /mcp handler itself calls, so this series can never drift from the real
    // enforcement state. Distinct from `up{job="financial-pipeline-mcp-server"}` —
    // this fires even while the process is healthy and answering requests.
    renderGauge(
      'finpipe_mcp_auth_enabled',
      'Whether the /mcp endpoint currently enforces bearer-token auth (1) or is running unauthenticated (0)',
      [{ labels: {}, value: loadAuthToken() ? 1 : 0 }],
    ),
  ].join('\n\n') + '\n';
}

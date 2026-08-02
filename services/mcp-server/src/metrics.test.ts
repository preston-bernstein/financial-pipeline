import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@financial-pipeline/db', () => ({
  db: { execute: vi.fn() },
}));

const { db } = await import('@financial-pipeline/db');
const { renderMetrics } = await import('./metrics.js');

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Queries run in the exact order renderMetrics issues them (Promise.all evaluates the
  // array synchronously left-to-right, then one more query for work-quantity).
  mockExecute
    .mockResolvedValueOnce([ // run status counts
      { source: 'betterment', status: 'success', n: '12' },
      { source: 'betterment', status: 'failure', n: '3' },
      { source: 'plaid', status: 'success', n: '40' },
    ])
    .mockResolvedValueOnce([ // last run (any status) per source
      { source: 'betterment', status: 'failure', completed_at: '2026-08-01T12:00:00Z' },
    ])
    .mockResolvedValueOnce([ // last SUCCESS per source
      { source: 'betterment', status: 'success', completed_at: '2026-07-31T20:00:00Z' },
    ])
    .mockResolvedValueOnce([ // enrichment tier distribution
      { prompt_version: 'enrich-v1-l1', n: '800' },
      { prompt_version: 'enrich-v1-l2', n: '150' },
      { prompt_version: 'enrich-v1-l3', n: '10' },
    ])
    .mockResolvedValueOnce([{ n: '42' }]) // unenriched
    .mockResolvedValueOnce([{ n: '2' }]) // materialization backlog
    .mockResolvedValueOnce([{ n: '1' }]) // stuck running
    .mockResolvedValueOnce([{ source: 'betterment', rows_written: 0 }]); // last rows_written
});

describe('renderMetrics — payload-free Prometheus exporter', () => {
  it('emits every required series with correct labels and values', async () => {
    const text = await renderMetrics();

    expect(text).toContain('finpipe_run_outcome_total{source="betterment",status="success"} 12');
    expect(text).toContain('finpipe_run_outcome_total{source="betterment",status="failure"} 3');
    expect(text).toContain('finpipe_run_outcome_total{source="plaid",status="success"} 40');
    expect(text).toContain('finpipe_last_run_timestamp_seconds{source="betterment"}');
    expect(text).toContain('finpipe_last_success_timestamp_seconds{source="betterment"}');
    expect(text).toContain('finpipe_enrichment_tier_total{tier="enrich-v1-l1"} 800');
    expect(text).toContain('finpipe_enrichment_tier_total{tier="enrich-v1-l2"} 150');
    expect(text).toContain('finpipe_enrichment_tier_total{tier="enrich-v1-l3"} 10');
    expect(text).toContain('finpipe_unenriched_transactions 42');
    expect(text).toContain('finpipe_materialization_backlog 2');
    expect(text).toContain('finpipe_runs_stuck_running 1');
    expect(text).toContain('finpipe_work_quantity{source="betterment"} 0');
  });

  it('carries no PII-shaped label or value — no account id, merchant, amount, or free text', async () => {
    const text = await renderMetrics();
    // Every label key across the whole document must come from the closed set below.
    const labelKeys = [...text.matchAll(/\{([^}]*)\}/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((pair) => pair.split('=')[0]!)
      .filter(Boolean);
    const allowed = new Set(['source', 'status', 'tier']);
    for (const key of labelKeys) {
      expect(allowed.has(key), `unexpected label key "${key}" — metrics must stay payload-free`).toBe(true);
    }
    // No dollar-amount-shaped or long free-text value anywhere in the document.
    expect(text).not.toMatch(/\$[\d,]+\.\d{2}/);
  });

  it('is valid Prometheus text exposition format (HELP/TYPE precede each metric family)', async () => {
    const text = await renderMetrics();
    const families = text.trim().split('\n\n');
    for (const family of families) {
      const lines = family.split('\n');
      expect(lines[0]).toMatch(/^# HELP finpipe_\w+ /);
      expect(lines[1]).toMatch(/^# TYPE finpipe_\w+ (counter|gauge)$/);
    }
  });
});

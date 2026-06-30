export interface TxRow {
  date: string;
  amount: string;
  llm_category: string | null;
  category: string | null;
}

export interface SnapshotRow {
  source: string;
  account_id: string;
  account_name: string;
  balance: string;
  currency: string;
  captured_at: Date;
}

export interface MonthAggregate {
  year: number;
  month: number;
  total: string;
  by_category: Record<string, string>;
}

export interface NetWorthResult {
  total: number;
  by_source: Record<string, number>;
}

export function aggregateMonthly(txs: TxRow[]): MonthAggregate[] {
  const map = new Map<string, { total: number; by_cat: Record<string, number> }>();

  for (const tx of txs) {
    const d = new Date(tx.date + 'T00:00:00Z');
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const cat = tx.llm_category ?? tx.category ?? 'other';
    const amount = parseFloat(tx.amount);

    if (!map.has(key)) map.set(key, { total: 0, by_cat: {} });
    const entry = map.get(key)!;
    entry.total += amount;
    entry.by_cat[cat] = (entry.by_cat[cat] ?? 0) + amount;
  }

  return Array.from(map.entries()).map(([key, { total, by_cat }]) => {
    const [yearStr, monthStr] = key.split('-');
    return {
      year: parseInt(yearStr!, 10),
      month: parseInt(monthStr!, 10),
      total: total.toFixed(2),
      by_category: Object.fromEntries(
        Object.entries(by_cat).map(([k, v]) => [k, v.toFixed(2)]),
      ),
    };
  });
}

export function computeNetWorth(snapshots: SnapshotRow[]): NetWorthResult {
  // Pick latest snapshot per (source, account_id)
  const latest = new Map<string, SnapshotRow>();
  for (const s of snapshots) {
    const key = `${s.source}:${s.account_id}`;
    const existing = latest.get(key);
    if (!existing || s.captured_at > existing.captured_at) {
      latest.set(key, s);
    }
  }

  let total = 0;
  const by_source: Record<string, number> = {};
  for (const s of latest.values()) {
    const bal = parseFloat(s.balance);
    total += bal;
    by_source[s.source] = (by_source[s.source] ?? 0) + bal;
  }

  return { total, by_source };
}

export function isStale(lastAt: Date | null, windowHours: number): boolean {
  if (!lastAt) return true;
  return Date.now() - lastAt.getTime() > windowHours * 3_600_000;
}

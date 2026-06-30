import { createLogger } from '@financial-pipeline/adapter-utils';

const log = createLogger('journal');
const JOURNAL_MODEL = process.env.JOURNAL_MODEL ?? 'llama3.2';
const BROKER_URL = process.env.JOURNAL_BROKER_URL;

interface JournalContext {
  monthLabel: string;
  netWorth: number;
  prevNetWorth: number | null;
  monthlyTotal: number;
  byCategory: Record<string, number>;
  goalProgress: Array<{ name: string; balance: number }>;
}

export async function generateJournalEntry(ctx: JournalContext): Promise<string | null> {
  if (!BROKER_URL) {
    log.warn('OLLAMA_BROKER_URL not set — skipping journal generation');
    return null;
  }

  const nwChange = ctx.prevNetWorth !== null
    ? `(${ctx.netWorth >= ctx.prevNetWorth ? '+' : ''}$${(ctx.netWorth - ctx.prevNetWorth).toFixed(0)} from prior month)`
    : '(no prior month data)';

  const topCats = Object.entries(ctx.byCategory)
    .filter(([cat]) => !['income', 'transfers'].includes(cat))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cat, amt]) => `${cat}: $${amt.toFixed(0)}`)
    .join(', ');

  const goals = ctx.goalProgress.length > 0
    ? ctx.goalProgress.map(g => `${g.name}: $${g.balance.toFixed(0)}`).join(', ')
    : 'no goal data';

  const prompt = `You are maintaining a personal finance journal. Write a concise monthly summary (3–5 sentences, first person) based on the data below. Be specific about amounts. Note anything notable: big changes, new trends, areas to watch.

Month: ${ctx.monthLabel}
Net worth: $${ctx.netWorth.toFixed(0)} ${nwChange}
Monthly spending: $${ctx.monthlyTotal.toFixed(0)} total
Top spending categories: ${topCats || 'none'}
Betterment goals: ${goals}

Write only the journal entry text, no preamble.`;

  try {
    const res = await fetch(`${BROKER_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JOURNAL_MODEL, prompt, stream: false }),
    });

    if (!res.ok) throw new Error(`broker ${res.status}`);
    const data = await res.json() as { response?: string };
    return data.response?.trim() ?? null;
  } catch (err) {
    log.error({ err }, 'journal generation failed');
    return null;
  }
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function journalModel(): string {
  return JOURNAL_MODEL;
}

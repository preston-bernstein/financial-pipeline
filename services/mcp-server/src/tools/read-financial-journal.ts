import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { db, journal_entries } from '@financial-pipeline/db';

const schema = z.object({
  months: z.number().min(1).max(24).default(3),
});

export async function readFinancialJournal(args: z.infer<typeof schema>) {
  const rows = await db
    .select()
    .from(journal_entries)
    .orderBy(desc(journal_entries.month_key))
    .limit(args.months);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(rows) }],
  };
}

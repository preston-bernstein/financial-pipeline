import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, monthly_spending } from '@financial-pipeline/db';

const schema = z.object({
  year: z.number().optional(),
  month: z.number().min(1).max(12).optional(),
});

export async function getMonthlySpending(args: z.infer<typeof schema>) {
  const conditions = [];
  if (args.year !== undefined) conditions.push(eq(monthly_spending.year, args.year));
  if (args.month !== undefined) conditions.push(eq(monthly_spending.month, args.month));

  const rows = await db
    .select()
    .from(monthly_spending)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(monthly_spending.year), desc(monthly_spending.month));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(rows) }],
  };
}

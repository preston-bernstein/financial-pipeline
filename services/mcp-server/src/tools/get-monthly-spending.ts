import { z } from 'zod';
import { db, monthly_spending, runs } from '@financial-pipeline/db';

const schema = z.object({
  year: z.number().optional(),
  month: z.number().min(1).max(12).optional(),
});

export async function getMonthlySpending(args: z.infer<typeof schema>) {
  // TODO: query monthly_spending aggregate, check staleness window
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ stub: true }) }],
  };
}

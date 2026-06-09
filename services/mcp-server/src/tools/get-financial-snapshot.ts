import { getMonthlySpending } from './get-monthly-spending.js';
import { getNetWorth } from './get-net-worth.js';
import { getGoalProgress } from './get-goal-progress.js';
import { getDerivedCeiling } from './get-derived-ceiling.js';
import { getAdapterHealth } from './get-adapter-health.js';

export async function getFinancialSnapshot() {
  const [spending, netWorth, goals, ceiling, health] = await Promise.all([
    getMonthlySpending({}),
    getNetWorth(),
    getGoalProgress(),
    getDerivedCeiling(),
    getAdapterHealth(),
  ]);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ spending, netWorth, goals, ceiling, health }) }],
  };
}

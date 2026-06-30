import { loadConfig } from '../config.js';

export async function getDerivedCeiling() {
  const config = loadConfig();
  const monthly_net = config.income.monthly_net;
  const total_savings = config.savings.roth_monthly + config.savings.betterment_monthly;
  const ceiling = monthly_net - total_savings;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ monthly_net, total_savings, ceiling }),
    }],
  };
}

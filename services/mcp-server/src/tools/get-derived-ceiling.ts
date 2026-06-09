import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { z } from 'zod';

const ConfigSchema = z.object({
  income: z.object({
    monthly_net: z.number().positive(),
  }),
  savings: z.object({
    roth_monthly: z.number().nonnegative(),
    betterment_monthly: z.number().nonnegative(),
  }),
});

let cachedConfig: z.infer<typeof ConfigSchema> | null = null;

function loadConfig(): z.infer<typeof ConfigSchema> {
  if (!cachedConfig) {
    const raw = parse(readFileSync('/config/pipeline.config.toml', 'utf8'));
    cachedConfig = ConfigSchema.parse(raw);
  }
  return cachedConfig;
}

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

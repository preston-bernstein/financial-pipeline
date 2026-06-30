import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { z } from 'zod';

export const PipelineConfigSchema = z.object({
  income: z.object({ monthly_net: z.number().positive() }),
  savings: z.object({
    roth_monthly: z.number().nonnegative(),
    betterment_monthly: z.number().nonnegative(),
  }),
  staleness: z.object({
    plaid_hours: z.number().positive().default(8),
    betterment_hours: z.number().positive().default(48),
    vanguard_hours: z.number().positive().default(48),
    fidelity_hours: z.number().positive().default(48),
  }),
  alerts: z.object({
    critical_topic: z.string().default(''),
    warning_topic: z.string().default(''),
  }).optional(),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

let cached: PipelineConfig | null = null;

export function loadConfig(): PipelineConfig {
  if (!cached) {
    const raw = parse(readFileSync('/config/pipeline.config.toml', 'utf8'));
    cached = PipelineConfigSchema.parse(raw);
  }
  return cached;
}

import { db, runs } from '@financial-pipeline/db';

export async function getAdapterHealth() {
  // TODO: query most recent run per source, compute staleness vs windows from config
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ stub: true }) }],
  };
}

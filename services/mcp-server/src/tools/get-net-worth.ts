import { db, snapshots } from '@financial-pipeline/db';

export async function getNetWorth() {
  // TODO: sum latest snapshot per source, check staleness per ADR 0010
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ stub: true }) }],
  };
}

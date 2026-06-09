import { db, snapshots } from '@financial-pipeline/db';

export async function getGoalProgress() {
  // TODO: return latest betterment snapshot per goal, include stale flag (ADR 0010)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ stub: true }) }],
  };
}

import type { Page } from 'playwright';

export interface BettermentGoal {
  account_id: string;
  account_name: string;
  balance: number;
  metadata: { target?: number; allocation?: string };
}

function parseDollar(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, '')) || 0;
}

// Selectors are best-effort — validate after first run and update as needed
export async function scrapeGoals(page: Page): Promise<BettermentGoal[]> {
  await page.goto('https://app.betterment.com/');
  await page.waitForLoadState('networkidle', { timeout: 45_000 });

  // Post-login redirect; wait for goal tiles to render
  await page.waitForSelector(
    '[data-testid="goal-tile"], [data-testid="goal-card"], [class*="GoalTile"], [class*="goal-tile"]',
    { timeout: 30_000 },
  );

  const goals = await page.evaluate(() => {
    // Try multiple selector strategies in priority order
    const tiles =
      Array.from(document.querySelectorAll('[data-testid="goal-tile"]')) ||
      Array.from(document.querySelectorAll('[data-testid="goal-card"]')) ||
      Array.from(document.querySelectorAll('[class*="GoalTile"]'));

    return tiles.map((tile) => {
      const nameEl =
        tile.querySelector('[data-testid="goal-name"]') ||
        tile.querySelector('[class*="goal-name"]') ||
        tile.querySelector('h2, h3, h4');

      const balanceEl =
        tile.querySelector('[data-testid="goal-balance"]') ||
        tile.querySelector('[data-testid="balance"]') ||
        tile.querySelector('[class*="balance"]') ||
        tile.querySelector('[class*="Balance"]');

      const targetEl =
        tile.querySelector('[data-testid="goal-target"]') ||
        tile.querySelector('[class*="target"]');

      return {
        name: nameEl?.textContent?.trim() ?? 'Unknown Goal',
        balance: balanceEl?.textContent?.trim() ?? '0',
        target: targetEl?.textContent?.trim() ?? null,
      };
    });
  });

  return goals
    .filter(g => g.name !== 'Unknown Goal' || g.balance !== '0')
    .map((g) => ({
      account_id: g.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      account_name: g.name,
      balance: parseDollar(g.balance),
      metadata: {
        target: g.target ? parseDollar(g.target) : undefined,
      },
    }));
}

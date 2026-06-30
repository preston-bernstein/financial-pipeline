import type { Page } from 'playwright';

export interface VanguardAccount {
  account_id: string;
  account_name: string;
  balance: number;
  metadata: { account_type?: string; fund_count?: number };
}

function parseDollar(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, '')) || 0;
}

// Selectors target investor.vanguard.com — validate after first run
export async function scrapeAccounts(page: Page): Promise<VanguardAccount[]> {
  await page.goto('https://investor.vanguard.com/accounts-plans/accounts');
  await page.waitForLoadState('networkidle', { timeout: 45_000 });

  await page.waitForSelector(
    '[data-testid="account-tile"], [class*="AccountTile"], [class*="account-tile"], .account-item',
    { timeout: 30_000 },
  );

  const accounts = await page.evaluate(() => {
    const tiles =
      Array.from(document.querySelectorAll('[data-testid="account-tile"]')).length > 0
        ? Array.from(document.querySelectorAll('[data-testid="account-tile"]'))
        : Array.from(document.querySelectorAll('[class*="account"]')).filter(
            el => el.querySelector('[class*="balance"], [class*="value"]'),
          );

    return tiles.map(tile => {
      const nameEl =
        tile.querySelector('[data-testid="account-name"]') ||
        tile.querySelector('[class*="account-name"]') ||
        tile.querySelector('h2, h3, h4, [class*="name"]');

      const balanceEl =
        tile.querySelector('[data-testid="account-balance"]') ||
        tile.querySelector('[data-testid="total-value"]') ||
        tile.querySelector('[class*="balance"]') ||
        tile.querySelector('[class*="value"]');

      const typeEl = tile.querySelector('[class*="account-type"], [data-testid="account-type"]');

      return {
        name: nameEl?.textContent?.trim() ?? '',
        balance: balanceEl?.textContent?.trim() ?? '0',
        type: typeEl?.textContent?.trim() ?? '',
        id: (tile as HTMLElement).dataset['accountId'] ?? '',
      };
    });
  });

  return accounts
    .filter(a => a.balance !== '0' && a.name)
    .map(a => ({
      account_id: a.id || a.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      account_name: a.name,
      balance: parseDollar(a.balance),
      metadata: { account_type: a.type || undefined },
    }));
}

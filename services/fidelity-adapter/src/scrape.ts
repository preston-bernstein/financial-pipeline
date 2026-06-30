import type { Page } from 'playwright';

export interface FidelityAccount {
  account_id: string;
  account_name: string;
  balance: number;
  metadata: { account_type?: string };
}

function parseDollar(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, '')) || 0;
}

// Selectors target www.fidelity.com — validate after first run
export async function scrapeAccounts(page: Page): Promise<FidelityAccount[]> {
  // Navigate to the portfolio summary page
  await page.goto('https://www.fidelity.com/portfolio/summary');
  await page.waitForLoadState('networkidle', { timeout: 45_000 });

  // Fidelity may redirect to login; wait for account data
  await page.waitForSelector(
    '[data-testid="account-row"], .account-selector--item, [class*="AccountRow"], posweb-account-item',
    { timeout: 30_000 },
  );

  const accounts = await page.evaluate(() => {
    // Fidelity uses web components and class-based selectors
    const rows = [
      ...Array.from(document.querySelectorAll('[data-testid="account-row"]')),
      ...Array.from(document.querySelectorAll('.account-selector--item')),
      ...Array.from(document.querySelectorAll('posweb-account-item')),
    ].filter((el, i, arr) => arr.indexOf(el) === i); // dedupe

    return rows.map(row => {
      const nameEl =
        row.querySelector('[data-testid="account-name"]') ||
        row.querySelector('.account-selector--item-name') ||
        row.querySelector('[class*="account-name"]') ||
        row.querySelector('h3, h4, [class*="name"]');

      const balanceEl =
        row.querySelector('[data-testid="account-balance"]') ||
        row.querySelector('[data-testid="total-value"]') ||
        row.querySelector('[class*="balance"]') ||
        row.querySelector('[class*="value"]') ||
        row.querySelector('[class*="total"]');

      const acctNumEl =
        row.querySelector('[class*="account-number"]') ||
        row.querySelector('[data-testid="account-number"]');

      return {
        name: nameEl?.textContent?.trim() ?? '',
        balance: balanceEl?.textContent?.trim() ?? '0',
        acctNum: acctNumEl?.textContent?.trim().replace(/\D/g, '') ?? '',
      };
    });
  });

  return accounts
    .filter(a => a.name && a.balance !== '0')
    .map(a => ({
      account_id: a.acctNum || a.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      account_name: a.name,
      balance: parseDollar(a.balance),
      metadata: {},
    }));
}

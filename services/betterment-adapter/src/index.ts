import 'dotenv/config';
import { Cron } from 'croner';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { withRunRecord, createLogger, sendNtfyAlert } from '@financial-pipeline/adapter-utils';
import { db, snapshots } from '@financial-pipeline/db';
import { launchBrowserWithSession } from './browser.js';
import { scrapeGoals } from './scrape.js';

const log = createLogger('betterment-adapter');
const SESSION_PATH = process.env.SESSION_PATH ?? '/session/betterment.storageState.json';

async function run(): Promise<void> {
  try {
    await withRunRecord('betterment', async () => {
      const { context, close } = await launchBrowserWithSession(SESSION_PATH);
      try {
        const page = await context.newPage();
        const goals = await scrapeGoals(page);

        if (goals.length === 0) {
          log.warn('no goals scraped — selectors may need updating');
          return { rowsWritten: 0 };
        }

        const now = new Date();
        await db.insert(snapshots).values(
          goals.map(g => ({
            source: 'betterment',
            account_id: g.account_id,
            account_name: g.account_name,
            balance: g.balance.toFixed(2),
            currency: 'USD',
            metadata: g.metadata,
            captured_at: now,
          })),
        );

        return { rowsWritten: goals.length };
      } finally {
        await close();
      }
    });
  } catch (err) {
    await sendNtfyAlert(`betterment-adapter failed: ${err}`, {
      title: 'financial-pipeline',
      priority: 'high',
    });
    throw err;
  }
}

async function seedSession(): Promise<void> {
  log.info('seed-session: launching non-headless browser for manual login');
  log.info('Log in to Betterment. Session will auto-save when the dashboard loads.');

  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://app.betterment.com/');

  // Wait for post-login dashboard URL
  await page.waitForURL('**/app.betterment.com/**', { timeout: 300_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  await context.storageState({ path: SESSION_PATH });
  log.info({ path: SESSION_PATH }, 'session saved');
  await browser.close();
}

if (process.argv.includes('--seed-session')) {
  await seedSession().catch(err => { log.error({ err }); process.exit(1); });
  process.exit(0);
}

if (process.argv.includes('--run-now')) {
  await run().catch(err => { log.error({ err }); process.exit(1); });
  process.exit(0);
}

// daily at 8pm per ADR 0008
new Cron('0 20 * * *', () => { run().catch(err => log.error({ err }, 'cron run failed')); });
log.info('betterment-adapter scheduled (daily 20:00)');

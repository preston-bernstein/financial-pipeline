import 'dotenv/config';
import { Cron } from 'croner';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { withRunRecord, createLogger, sendNtfyAlert, classifyBalanceScrape, errFields } from '@financial-pipeline/adapter-utils';
import { db, snapshots } from '@financial-pipeline/db';
import { launchBrowserWithSession } from './browser.js';
import { scrapeAccounts } from './scrape.js';

const log = createLogger('fidelity-adapter');
const SESSION_PATH = process.env.SESSION_PATH ?? '/session/fidelity.storageState.json';

async function run(): Promise<void> {
  try {
    await withRunRecord('fidelity', async ({ log: runLog }) => {
      const { context, close } = await launchBrowserWithSession(SESSION_PATH);
      try {
        const page = await context.newPage();
        const accounts = await scrapeAccounts(page);

        // The did-nothing rule (CONVENTIONS.md §18) — see the identical comment in
        // betterment-adapter/src/index.ts for the full rationale. fidelity's AND filter
        // in scrape.ts already drops zero-balance tiles, so `all_zero_balance` is
        // structurally unreachable here, but the check stays for symmetry with the other
        // two balance adapters and as a guard against a future scrape.ts change.
        const { outcome, reason } = classifyBalanceScrape(accounts.map(a => a.balance));
        if (outcome === 'suspect') {
          runLog.error(
            { event: 'scrape.suspect_zero', reason, tiles_found: accounts.length },
            'fidelity scrape returned no usable balances',
          );
          throw new Error(`fidelity scrape suspect (${reason}) — selectors or session likely stale`);
        }

        const now = new Date();
        await db.insert(snapshots).values(
          accounts.map(a => ({
            source: 'fidelity',
            account_id: a.account_id,
            account_name: a.account_name,
            balance: a.balance.toFixed(2),
            currency: 'USD',
            metadata: a.metadata,
            captured_at: now,
          })),
        );

        return { rowsWritten: accounts.length };
      } finally {
        await close();
      }
    });
  } catch (err) {
    const fields = errFields(err);
    log.error({ event: 'run.alert_dispatch', ...fields }, 'fidelity-adapter run failed; dispatching ntfy alert');
    await sendNtfyAlert(`fidelity-adapter failed: ${fields.err_type}: ${fields.err_msg}`, {
      title: 'financial-pipeline',
      priority: 'high',
    });
    throw err;
  }
}

async function seedSession(): Promise<void> {
  log.info('seed-session: launching non-headless browser for manual login');
  log.info('Log in to Fidelity. Session will auto-save when portfolio page loads.');
  log.info('NOTE: if running in Docker, set DISPLAY or use VNC. See README.');

  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.fidelity.com/');
  await page.waitForURL('**/fidelity.com/portfolio**', { timeout: 300_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  await context.storageState({ path: SESSION_PATH });
  log.info({ path: SESSION_PATH }, 'session saved');
  await browser.close();
}

if (process.argv.includes('--seed-session')) {
  await seedSession().catch(err => {
    log.error({ event: 'cli.seed_session_failed', ...errFields(err) }, 'fidelity-adapter --seed-session failed');
    process.exit(1);
  });
  process.exit(0);
}

if (process.argv.includes('--run-now')) {
  await run().catch(err => {
    log.error({ event: 'cli.run_now_failed', ...errFields(err) }, 'fidelity-adapter --run-now failed');
    process.exit(1);
  });
  process.exit(0);
}

// daily at 7pm per ADR 0008
new Cron('0 19 * * *', () => {
  run().catch(err => log.error({ event: 'cron.run_failed', ...errFields(err) }, 'fidelity-adapter cron run failed'));
});
log.info('fidelity-adapter scheduled (daily 19:00)');

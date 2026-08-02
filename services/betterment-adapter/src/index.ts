import 'dotenv/config';
import { Cron } from 'croner';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { withRunRecord, createLogger, sendNtfyAlert, classifyBalanceScrape, errFields } from '@financial-pipeline/adapter-utils';
import { db, snapshots } from '@financial-pipeline/db';
import { launchBrowserWithSession } from './browser.js';
import { scrapeGoals } from './scrape.js';

const log = createLogger('betterment-adapter');
const SESSION_PATH = process.env.SESSION_PATH ?? '/session/betterment.storageState.json';

async function run(): Promise<void> {
  try {
    await withRunRecord('betterment', async ({ log: runLog }) => {
      const { context, close } = await launchBrowserWithSession(SESSION_PATH);
      try {
        const page = await context.newPage();
        const goals = await scrapeGoals(page);

        // The did-nothing rule (CONVENTIONS.md §18): a scrape that found nothing, or that
        // found tiles whose name selector matched but whose balance selector didn't (every
        // balance reads exactly $0.00 — not plausible for a funded account), must NOT be
        // recorded as a successful run. Previously this silently inserted $0.00 snapshots
        // (empty-scrape case returned success with 0 rows; the OR filter in scrape.ts kept
        // zero-balance tiles outright) and every downstream consumer — get_net_worth, the
        // journal — reported a collapsed net worth as fact. Throwing here routes through
        // withRunRecord's existing failure path: status='failure' in `runs`, and the ntfy
        // alert below actually fires instead of staying silent.
        const { outcome, reason } = classifyBalanceScrape(goals.map(g => g.balance));
        if (outcome === 'suspect') {
          runLog.error(
            { event: 'scrape.suspect_zero', reason, tiles_found: goals.length },
            'betterment scrape returned no usable balances',
          );
          throw new Error(`betterment scrape suspect (${reason}) — selectors or session likely stale`);
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
    const fields = errFields(err);
    log.error({ event: 'run.alert_dispatch', ...fields }, 'betterment-adapter run failed; dispatching ntfy alert');
    await sendNtfyAlert(`betterment-adapter failed: ${fields.err_type}: ${fields.err_msg}`, {
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
  await seedSession().catch(err => {
    log.error({ event: 'cli.seed_session_failed', ...errFields(err) }, 'betterment-adapter --seed-session failed');
    process.exit(1);
  });
  process.exit(0);
}

if (process.argv.includes('--run-now')) {
  await run().catch(err => {
    log.error({ event: 'cli.run_now_failed', ...errFields(err) }, 'betterment-adapter --run-now failed');
    process.exit(1);
  });
  process.exit(0);
}

// daily at 8pm per ADR 0008
new Cron('0 20 * * *', () => {
  run().catch(err => log.error({ event: 'cron.run_failed', ...errFields(err) }, 'betterment-adapter cron run failed'));
});
log.info('betterment-adapter scheduled (daily 20:00)');

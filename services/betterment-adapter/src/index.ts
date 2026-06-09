import 'dotenv/config';
import { Cron } from 'croner';
import { withRunRecord, createLogger } from '@financial-pipeline/adapter-utils';
import { launchBrowserWithSession } from './browser.js';

const log = createLogger('betterment-adapter');
const SESSION_PATH = '/session/betterment.storageState.json';

async function run(): Promise<void> {
  await withRunRecord('betterment', async () => {
    const { context, close } = await launchBrowserWithSession(SESSION_PATH);
    try {
      const page = await context.newPage();

      // TODO: navigate goals dashboard and extract balances per ADR 0005
      // await page.goto('https://app.betterment.com/');
      // const goals = await scrapeGoals(page);
      // await db.insert(snapshots).values(goals.map(toSnapshot));

      return { rowsWritten: 0 };
    } finally {
      await close();
    }
  });
}

// daily at 8pm per ADR 0008
new Cron('0 20 * * *', () => { run().catch((err) => log.error({ err }, 'cron run failed')); });
log.info('betterment-adapter scheduled (daily 20:00)');

if (process.argv.includes('--run-now')) run().catch((err) => { log.error({ err }); process.exit(1); });

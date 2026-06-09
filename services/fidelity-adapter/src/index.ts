import 'dotenv/config';
import { Cron } from 'croner';
import { withRunRecord, createLogger } from '@financial-pipeline/adapter-utils';
import { launchBrowserWithSession } from './browser.js';

const log = createLogger('fidelity-adapter');
const SESSION_PATH = '/session/fidelity.storageState.json';

async function run(): Promise<void> {
  await withRunRecord('fidelity', async () => {
    const { context, close } = await launchBrowserWithSession(SESSION_PATH);
    try {
      const page = await context.newPage();

      // TODO: navigate to account summary, extract Roth IRA balance only per ADR 0006
      // await page.goto('https://www.fidelity.com/');
      // const balance = await scrapeRothBalance(page);
      // await db.insert(snapshots).values({ source: 'fidelity', account_id: 'roth-ira', balance, ... });

      return { rowsWritten: 0 };
    } finally {
      await close();
    }
  });
}

// daily at 7pm per ADR 0008
new Cron('0 19 * * *', () => { run().catch((err) => log.error({ err }, 'cron run failed')); });
log.info('fidelity-adapter scheduled (daily 19:00)');

if (process.argv.includes('--run-now')) run().catch((err) => { log.error({ err }); process.exit(1); });

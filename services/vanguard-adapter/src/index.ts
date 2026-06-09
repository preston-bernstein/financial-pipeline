import 'dotenv/config';
import { Cron } from 'croner';
import { withRunRecord, launchBrowserWithSession, createLogger } from '@financial-pipeline/adapter-utils';

const log = createLogger('vanguard-adapter');
const SESSION_PATH = '/session/vanguard.storageState.json';

async function run(): Promise<void> {
  await withRunRecord('vanguard', async () => {
    const { context, close } = await launchBrowserWithSession(SESSION_PATH);
    try {
      const page = await context.newPage();

      // TODO: navigate account summary, extract balance + fund allocation per ADR 0006
      // await page.goto('https://personal.vanguard.com/');
      // const { balance, allocation } = await scrapeAccount(page);
      // await db.insert(snapshots).values({ source: 'vanguard', ... metadata: { allocation } });

      return { rowsWritten: 0 };
    } finally {
      await close();
    }
  });
}

// daily at 7pm per ADR 0008
new Cron('0 19 * * *', () => { run().catch((err) => log.error({ err }, 'cron run failed')); });
log.info('vanguard-adapter scheduled (daily 19:00)');

if (process.argv.includes('--run-now')) run().catch((err) => { log.error({ err }); process.exit(1); });

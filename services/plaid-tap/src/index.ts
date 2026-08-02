import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PlaidApi, PlaidEnvironments, Configuration } from 'plaid';
import { sql } from 'drizzle-orm';
import { Cron } from 'croner';
import { withRunRecord, createLogger, errFields } from '@financial-pipeline/adapter-utils';
import { db, transactions } from '@financial-pipeline/db';

const log = createLogger('plaid-tap');

interface PlaidCredentials {
  client_id: string;
  secret: string;
  access_tokens: string[];
  environment: 'sandbox' | 'production';
}

type CursorStore = Record<string, string>;

const CURSORS_PATH = '/data/plaid_cursors.json';

function loadCursors(): CursorStore {
  if (!existsSync(CURSORS_PATH)) return {};
  return JSON.parse(readFileSync(CURSORS_PATH, 'utf8')) as CursorStore;
}

function saveCursors(cursors: CursorStore): void {
  writeFileSync(CURSORS_PATH, JSON.stringify(cursors, null, 2));
}

// Never persist raw access tokens — cursor file keys are sha256 of the token.
function cursorKey(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

// Rewrites the store keyed by token hash: migrates legacy plaintext-token keys
// and prunes entries for rotated/removed tokens.
function migrateCursors(raw: CursorStore, accessTokens: string[]): CursorStore {
  const migrated: CursorStore = {};
  for (const token of accessTokens) {
    const value = raw[cursorKey(token)] ?? raw[token];
    if (value) migrated[cursorKey(token)] = value;
  }
  return migrated;
}

async function run(): Promise<void> {
  const creds: PlaidCredentials = JSON.parse(
    readFileSync('/run/secrets/plaid_credentials', 'utf8')
  );

  if (!creds.access_tokens?.length) {
    log.info('no access_tokens configured — skipping run');
    return;
  }

  await withRunRecord('plaid', async ({ log: runLog }) => {
    const client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[creds.environment ?? 'production'],
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': creds.client_id,
            'PLAID-SECRET': creds.secret,
          },
        },
      })
    );

    // Migrate-and-persist up front so plaintext token keys are scrubbed from
    // disk even if this run fails partway.
    const cursors = migrateCursors(loadCursors(), creds.access_tokens);
    saveCursors(cursors);
    let totalRowsWritten = 0;

    for (const accessToken of creds.access_tokens) {
      let cursor: string | undefined = cursors[cursorKey(accessToken)];
      let hasMore = true;

      while (hasMore) {
        const { data } = await client.transactionsSync({
          access_token: accessToken,
          cursor,
          count: 500,
        });

        const toUpsert = [...data.added, ...data.modified].map((t) => ({
          id: t.transaction_id,
          account_id: t.account_id,
          amount: t.amount.toFixed(2),
          currency: (t.iso_currency_code ?? 'USD'),
          date: t.date,
          description: t.name,
          merchant_name: t.merchant_name ?? null,
          category: t.personal_finance_category?.primary ?? t.category?.[0] ?? null,
          pending: t.pending,
          source: 'plaid' as const,
        }));

        if (toUpsert.length > 0) {
          const CHUNK = 500;
          for (let i = 0; i < toUpsert.length; i += CHUNK) {
            await db
              .insert(transactions)
              .values(toUpsert.slice(i, i + CHUNK))
              .onConflictDoUpdate({
                target: transactions.id,
                set: {
                  description: sql`excluded.description`,
                  merchant_name: sql`excluded.merchant_name`,
                  category: sql`excluded.category`,
                  pending: sql`excluded.pending`,
                  amount: sql`excluded.amount`,
                },
              });
          }
          totalRowsWritten += toUpsert.length;
        }

        if (data.removed.length > 0) {
          runLog.info({ event: 'sync.removed', count: data.removed.length }, 'transactions removed by Plaid (not yet purged from local DB)');
        }

        cursor = data.next_cursor;
        hasMore = data.has_more;
      }

      cursors[cursorKey(accessToken)] = cursor!;
    }

    saveCursors(cursors);

    // Unlike the balance adapters (betterment/vanguard/fidelity), 0 rows here is a
    // legitimate, common outcome — a cursor-based sync with no new/modified transactions
    // since the last run — not a sign of breakage, so this does NOT throw. Logged
    // explicitly so "0 rows written" reads as an intentional, benign observation rather
    // than an unremarked-on gap (the did-nothing rule, CONVENTIONS.md §18).
    runLog.info(
      { event: 'sync.completed', rows_written: totalRowsWritten, outcome: totalRowsWritten > 0 ? 'ok' : 'no_new_transactions' },
      'plaid sync completed',
    );

    return { rowsWritten: totalRowsWritten };
  });
}

// every 4 hours per ADR 0008
new Cron('0 */4 * * *', () => {
  run().catch((err) => log.error({ event: 'cron.run_failed', ...errFields(err) }, 'plaid-tap cron run failed'));
});
log.info('plaid-tap scheduled (every 4h)');

if (process.argv.includes('--run-now')) {
  run().catch((err) => {
    log.error({ event: 'cli.run_now_failed', ...errFields(err) }, 'plaid-tap --run-now failed');
    process.exit(1);
  });
}

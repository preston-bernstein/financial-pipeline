import { existsSync } from 'node:fs';
import { chromium, type BrowserContext } from 'playwright';

export interface BrowserSession {
  context: BrowserContext;
  close(): Promise<void>;
}

export async function launchBrowserWithSession(sessionPath: string): Promise<BrowserSession> {
  if (!existsSync(sessionPath)) {
    throw new Error(
      `Session file not found: ${sessionPath}\n` +
      `Run the one-time login seeding flow to create it:\n` +
      `  docker compose run --rm <service> node dist/index.js --seed-session`
    );
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ storageState: sessionPath });
  return { context, close: () => browser.close() };
}

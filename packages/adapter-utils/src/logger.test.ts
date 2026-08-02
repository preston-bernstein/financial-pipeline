import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from './logger.js';

// Captures raw pino output (newline-delimited JSON) written to stdout so we can assert
// on the actual bytes that would reach `docker logs` — not on the object passed in.
function captureLogger(name: string) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger(name, stream);
  return { logger, lines: () => chunks.join('') };
}

// This is the enforcement mechanism for the whole Loki exclusion (docs/adr/0018): if a
// deny-listed field's *value* ever appears in emitted log bytes, the redaction boundary in
// logger.ts has regressed and this test must fail.
describe('createLogger redaction', () => {
  it('never emits deny-listed field values, even when a call site logs them directly', () => {
    const { logger, lines } = captureLogger('test-service');

    const secrets: Record<string, string> = {
      password: 'hunter2',
      token: 'tok_abc123',
      api_key: 'key_live_456',
      secret: 'shh-dont-log-me',
      authorization: 'Bearer super-secret-jwt',
      access_token: 'at_789',
      refresh_token: 'rt_012',
      ssn: '123-45-6789',
      cookie: 'sessionid=abc123',
      session: 'sess_xyz',
      raw: 'KROGER $45.32 groceries; CHIPOTLE $12.50 restaurants',
      body: '{"error":"invalid request for tx WHOLE FOODS $203.11"}',
      description: 'WHOLE FOODS MARKET #1234',
      merchant_name: 'Whole Foods',
      account_id: 'acct_live_9988',
      account_number: '000123456789',
      balance: '183442.17',
    };

    logger.error(secrets, 'redaction smoke test');
    logger.warn({ nested: { ...secrets } }, 'nested redaction smoke test');

    const output = lines();
    for (const [key, value] of Object.entries(secrets)) {
      expect(output, `field "${key}" leaked its value into log output`).not.toContain(value);
    }
    // sanity: the test actually captured something, and the message survived
    expect(output).toContain('redaction smoke test');
    expect(output).toContain('[REDACTED]');
  });

  it('leaves non-denied fields (the ones a dashboard or grep actually needs) untouched', () => {
    const { logger, lines } = captureLogger('test-service');

    logger.info(
      { run_id: 42, source: 'betterment', outcome: 'ok', rows_written: 3, event: 'run.completed' },
      'run completed',
    );

    const output = lines();
    expect(output).toContain('"run_id":42');
    expect(output).toContain('"source":"betterment"');
    expect(output).toContain('"outcome":"ok"');
    expect(output).toContain('"event":"run.completed"');
  });
});

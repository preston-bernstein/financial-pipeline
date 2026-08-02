import pino from 'pino';

// Redaction deny-list. Two tiers, both enforced at the logging boundary (never at each
// call site — a call-site convention needs every future line in this repo to remember it
// forever, and one miss is a leak):
//   1. home-infra CONVENTIONS.md §18's fleet-wide deny-list (credentials/secrets).
//   2. This repo's own PII-bearing field names — a malformed LLM reply or a RunPod error
//      body can otherwise echo up to 30 verbatim transaction descriptions/merchants/amounts
//      in one line (see services/llm-enricher/src/enrich.ts, fixed alongside this file).
// This is a key-name deny-list, not a value scanner: it stops a field logged under one of
// these keys, not a secret/PII value logged under an unlisted key. That residual gap is why
// this repo is *additionally* excluded from shipping logs to Loki at all (docs/adr/0018).
const REDACT_KEYS = [
  // fleet-wide (CONVENTIONS.md §18)
  'password', 'passwd', 'token', 'api_key', 'apikey', 'secret',
  'authorization', 'access_token', 'refresh_token', 'ssn', 'cookie', 'session',
  // this repo's own PII surface
  'raw', 'body', 'description', 'merchant_name', 'account_id', 'account_number', 'balance',
];

const REDACT_PATHS = [
  ...REDACT_KEYS,
  ...REDACT_KEYS.map((k) => `*.${k}`),
  // proxy-URL family / nested auth headers a future call site might log
  'err.config.headers.authorization',
  'req.headers.authorization',
];

export function createLogger(name: string, destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    name,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;

import pino from 'pino';

export function createLogger(name: string) {
  return pino({ name });
}

export type Logger = ReturnType<typeof createLogger>;

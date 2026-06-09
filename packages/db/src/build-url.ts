import { readFileSync } from 'node:fs';

export function buildDbUrl(): string {
  const base = process.env.DATABASE_URL!;
  try {
    const password = readFileSync('/run/secrets/postgres_password', 'utf8').trim();
    const url = new URL(base);
    url.password = encodeURIComponent(password);
    return url.toString();
  } catch {
    // local dev: password already in DATABASE_URL or no auth configured
    return base;
  }
}

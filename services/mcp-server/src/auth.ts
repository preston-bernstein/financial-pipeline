import { readFileSync } from 'node:fs';

// Bearer token: docker secret if mounted, else env. Without one the server is
// unauthenticated — callers are expected to warn loudly and log the security
// posture (metrics.ts exports it as finpipe_mcp_auth_enabled).
export function loadAuthToken(): string | null {
  try {
    return readFileSync('/run/secrets/mcp_auth_token', 'utf8').trim() || null;
  } catch {
    return process.env.MCP_AUTH_TOKEN?.trim() || null;
  }
}

import 'dotenv/config';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createLogger, errFields } from '@financial-pipeline/adapter-utils';
import { loadAuthToken } from './auth.js';
import { renderMetrics } from './metrics.js';
import { getMonthlySpending } from './tools/get-monthly-spending.js';
import { getNetWorth } from './tools/get-net-worth.js';
import { getGoalProgress } from './tools/get-goal-progress.js';
import { getDerivedCeiling } from './tools/get-derived-ceiling.js';
import { getAdapterHealth } from './tools/get-adapter-health.js';
import { getFinancialSnapshot } from './tools/get-financial-snapshot.js';
import { readFinancialJournal } from './tools/read-financial-journal.js';

const log = createLogger('mcp-server');
const PORT = Number(process.env.MCP_PORT ?? 3101);

// Bearer token: docker secret if mounted, else env. Without one the server is
// unauthenticated — loud warning below, since tools expose full financial state.
const AUTH_TOKEN = loadAuthToken();
if (!AUTH_TOKEN) {
  log.warn('no MCP_AUTH_TOKEN (or /run/secrets/mcp_auth_token) configured — mcp-server is UNAUTHENTICATED; any client that can reach the port can read financial data');
}

// DNS-rebinding defense: IP-literal and localhost Hosts can't be rebound; any
// DNS name (e.g. Tailscale MagicDNS) must be allowlisted explicitly.
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);
// Browser requests always carry Origin; MCP clients don't. Reject any Origin
// not explicitly allowlisted so a web page can't drive this server.
const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  if (ALLOWED_HOSTS.includes(hostHeader)) return true;
  const hostname = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || isIP(hostname) !== 0 || ALLOWED_HOSTS.includes(hostname);
}

function authorized(authHeader: string | undefined): boolean {
  if (!AUTH_TOKEN) return true;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const given = Buffer.from(authHeader.slice('Bearer '.length));
  const want = Buffer.from(AUTH_TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function buildServer(): McpServer {
  // cast avoids TS2589 — McpServer accumulates deep generics per registered tool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = new McpServer({ name: 'financial-pipeline', version: '0.0.1' }) as any;

  server.tool(
    'get_monthly_spending',
    'Monthly spending totals, optionally filtered by year and month',
    { year: z.number().optional(), month: z.number().min(1).max(12).optional() },
    getMonthlySpending,
  );

  server.tool('get_net_worth', 'Current net worth across all accounts', {}, getNetWorth);
  server.tool('get_goal_progress', 'Betterment goal balances and progress', {}, getGoalProgress);
  server.tool('get_derived_ceiling', 'Implied monthly spending limit from net income minus savings outflows', {}, getDerivedCeiling);
  server.tool('get_adapter_health', 'Last run time and status for each adapter', {}, getAdapterHealth);
  server.tool('get_financial_snapshot', 'All key metrics in one call', {}, getFinancialSnapshot);
  server.tool(
    'read_financial_journal',
    'LLM-generated monthly summaries of financial state (Karpathy wiki pattern)',
    { months: z.number().min(1).max(24).default(3) },
    readFinancialJournal,
  );

  return server as McpServer;
}

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Payload-free metrics (CONVENTIONS.md §18) — deliberately a SEPARATE unauthenticated
    // path, not gated behind the Host/Origin/bearer checks below. Those defenses exist
    // because /mcp exposes full financial state to whatever can reach it; /metrics exposes
    // only counts and timestamps (see metrics.ts), so it carries none of that risk, and
    // coupling it to MCP's stricter checks would make a routine Prometheus scrape (which
    // hits this by container DNS name, not localhost/an IP literal) fail the DNS-rebinding
    // Host check for no security benefit.
    if (url.pathname === '/metrics') {
      const body = await renderMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(body);
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    if (!hostAllowed(req.headers.host)) {
      log.warn({ host: req.headers.host }, 'rejected request: Host not allowed (DNS rebinding defense)');
      res.writeHead(403).end('forbidden host');
      return;
    }

    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      log.warn({ origin }, 'rejected request: browser Origin not allowlisted');
      res.writeHead(403).end('forbidden origin');
      return;
    }

    if (!authorized(req.headers.authorization)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('unauthorized');
      return;
    }

    // Stateless Streamable HTTP: fresh McpServer + transport per request —
    // Protocol.connect throws on a second connect to a shared instance.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    log.error({ event: 'request.failed', url: req.url, ...errFields(err) }, 'mcp-server request handling failed');
    if (!res.headersSent) res.writeHead(500).end();
  }
});

httpServer.listen(PORT, () => log.info({ event: 'server.listening', port: PORT, endpoint: '/mcp', metrics_endpoint: '/metrics', auth: !!AUTH_TOKEN }, 'mcp-server listening (Streamable HTTP)'));

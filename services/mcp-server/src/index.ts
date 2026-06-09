import 'dotenv/config';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { createLogger } from '@financial-pipeline/adapter-utils';
import { getMonthlySpending } from './tools/get-monthly-spending.js';
import { getNetWorth } from './tools/get-net-worth.js';
import { getGoalProgress } from './tools/get-goal-progress.js';
import { getDerivedCeiling } from './tools/get-derived-ceiling.js';
import { getAdapterHealth } from './tools/get-adapter-health.js';
import { getFinancialSnapshot } from './tools/get-financial-snapshot.js';

const log = createLogger('mcp-server');
const PORT = Number(process.env.MCP_PORT ?? 3101);

// cast avoids TS2589 — McpServer accumulates deep generics per registered tool
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = new McpServer({ name: 'financial-pipeline', version: '0.0.1' }) as any;

server.tool(
  'get_monthly_spending',
  'Monthly spending totals, optionally filtered by year and month',
  { year: z.number().optional(), month: z.number().min(1).max(12).optional() },
  getMonthlySpending
);

server.tool('get_net_worth', 'Current net worth across all accounts', {}, getNetWorth);
server.tool('get_goal_progress', 'Betterment goal balances and progress', {}, getGoalProgress);
server.tool('get_derived_ceiling', 'Implied monthly spending limit from net income minus savings outflows', {}, getDerivedCeiling);
server.tool('get_adapter_health', 'Last run time and status for each adapter', {}, getAdapterHealth);
server.tool('get_financial_snapshot', 'All key metrics in one call', {}, getFinancialSnapshot);

// SSE transport — Claude Code connects via http://NAS_IP:PORT/sse
const transports = new Map<string, SSEServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => transports.delete(transport.sessionId));
    await server.connect(transport);
    return;
  }

  if (req.method === 'POST' && req.url === '/messages') {
    const sessionId = req.headers['x-session-id'] as string;
    const transport = transports.get(sessionId);
    if (!transport) { res.writeHead(404).end(); return; }
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404).end();
});

httpServer.listen(PORT, () => log.info({ port: PORT }, 'mcp-server listening'));

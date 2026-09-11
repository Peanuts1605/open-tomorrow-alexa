import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';
import { CoverageStore, Plan, Change } from './coverage.mjs';

export async function startServer({ file = '.local/plan.json', port = 0 } = {}) {
  const store = new CoverageStore(file);
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use((req, res, next) => {
    // Local demo only: disallow web origins rather than silently accepting cross-site writes.
    if (req.headers.origin) return res.status(403).json({ error: 'Browser origins are not enabled for this local MCP proof.' });
    next();
  });
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'open-tomorrow', version: '0.1.0' });
    const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const guarded = fn => async args => {
      try { return result(fn(args)); }
      catch (err) { return { isError: true, content: [{ type: 'text', text: err.message }] }; }
    };
    server.registerTool('create_handover', {
      description: 'Initialize one fictional one-day handover. Never overwrites a plan. Explicit supplied tasks and availability only.',
      inputSchema: { plan: Plan }
    }, guarded(({ plan }) => store.create(plan)));
    server.registerTool('check_coverage', {
      description: 'Read exact coverage blockers and last change. Covered means entered tasks only, with simulated acceptance, never business safety.',
      inputSchema: {}, annotations: { readOnlyHint: true }
    }, guarded(() => store.read()));
    server.registerTool('change_handover', {
      description: 'Apply one version-checked fictional assignment, simulated acceptance, cancellation, time correction or scope confirmation. Read current revision first. No employee messages are sent.',
      inputSchema: { expectedRevision: z.number().int().positive(), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), change: Change }
    }, guarded(args => store.apply(args)));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  app.all('/mcp', (_req, res) => res.status(405).end());
  const http = await new Promise(resolve => { const listener = app.listen(port, '127.0.0.1', () => resolve(listener)); });
  return { url: `http://127.0.0.1:${http.address().port}/mcp`, close: () => new Promise((resolve, reject) => http.close(err => err ? reject(err) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({ port: 8917 });
  console.log(`Open Tomorrow local fictional-data MCP proof: ${server.url}`);
}

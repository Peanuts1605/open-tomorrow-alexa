import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { pathToFileURL } from 'node:url';
import { CoverageStore } from './coverage.mjs';
import { registerTools } from './tools.mjs';

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
    registerTools(server, store);
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

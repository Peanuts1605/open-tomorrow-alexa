// Cloudflare Worker: serves the simulated Alexa+ page and a real MCP endpoint (Streamable HTTP, 2025-11-25)
// backed by the same CoverageStore and tools as the local server. Each browser session gets its own
// Durable Object, so visitors never share or overwrite each other's fictional plan.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DurableObject } from 'cloudflare:workers';
import { CoverageStore } from '../coverage.mjs';
import { registerTools } from '../tools.mjs';
import { HTML } from './page.generated.mjs';

const SESSION = /^[a-zA-Z0-9-]{8,64}$/;
const security = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
};

export class HandoverSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/reset') { await this.ctx.storage.deleteAll(); return new Response(null, { status: 204 }); }
    let plan = (await this.ctx.storage.get('plan')) ?? null;
    let dirty = false;
    const store = new CoverageStore(null, { load: () => plan, save: next => { plan = next; dirty = true; } });
    const server = new McpServer({ name: 'open-tomorrow', version: '0.2.0' });
    registerTools(server, store);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    if (dirty) await this.ctx.storage.put('plan', plan);
    // Fictional demo data expires after a day of inactivity.
    await this.ctx.storage.setAlarm(Date.now() + 86_400_000);
    return response;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html')
      return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', ...security } });
    if (url.pathname === '/mcp' || url.pathname === '/reset') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Cross-origin requests are not enabled for this demo.' }, { status: 403 });
      const session = url.searchParams.get('session') ?? '';
      if (!SESSION.test(session)) return Response.json({ error: 'A demo session id is required: /mcp?session=<8-64 letters, digits or dashes>' }, { status: 400 });
      if (url.pathname === '/reset' && request.method !== 'POST') return new Response(null, { status: 405 });
      if (url.pathname === '/mcp' && request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session));
      return stub.fetch(new Request(new URL(url.pathname, 'https://session'), request));
    }
    return new Response('Not found', { status: 404 });
  }
};

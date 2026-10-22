// Cloudflare Worker: serves the simulated Alexa+ page and a real MCP endpoint (Streamable HTTP, 2025-11-25)
// backed by the same CoverageStore and tools as the local server. Each browser session gets its own
// Durable Object, so visitors never share or overwrite each other's fictional plan.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DurableObject } from 'cloudflare:workers';
import { CoverageStore } from '../coverage.mjs';
import { HELPER_HTML } from './helper.mjs';
import { registerTools } from '../tools.mjs';
import { HTML } from './page.generated.mjs';
import { interpret, DAILY_CAP, SESSION_CAP, utcDay } from './ai.mjs';

// One extra Durable Object holds the global Workers AI call counter. Its name contains '_', which the visitor
// session pattern below rejects, so no visitor request can reach or reset it.
const BUDGET = 'ai_budget';

const SESSION = /^[a-zA-Z0-9-]{8,64}$/;
const security = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  // The page itself may use the microphone (voice turns); nothing else may, and it cannot be framed.
  'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
};

export class HandoverSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/budget') {
      // Global daily cap: keeps Workers AI use far below the free daily allocation, so the AI layer costs $0.
      const key = `calls:${utcDay()}`, used = (await this.ctx.storage.get(key)) ?? 0;
      if (used >= DAILY_CAP) return Response.json({ ok: false, used });
      await this.ctx.storage.put(key, used + 1);
      await this.ctx.storage.setAlarm(Date.now() + 2 * 86_400_000);
      return Response.json({ ok: true, used: used + 1 });
    }
    if (url.pathname === '/reset') { await this.ctx.storage.deleteAll(); return new Response(null, { status: 204 }); }
    let plan = (await this.ctx.storage.get('plan')) ?? null;
    let dirty = false;
    const store = new CoverageStore(null, { load: () => plan, save: next => { plan = next; dirty = true; } });
    // Phone helper card (QR flow): a tiny read and one simulated acceptance, applied through the same CoverageStore rules.
    if (url.pathname === '/summary') {
      if (!plan) return Response.json({ revision: 0, pending: [] });
      const s = store.read();
      const label = id => plan.people.find(p => p.id === id)?.label ?? id;
      return Response.json({ revision: s.revision, status: s.status, pending: s.tasks.filter(t => t.assignee && t.blockers.length === 1 && t.blockers[0].code === 'AWAITING_ACCEPTANCE')
        .map(t => ({ task: t.id, label: t.label, start: t.start, end: t.end, person: t.assignee, personLabel: label(t.assignee) })) });
    }
    if (url.pathname === '/accept') {
      let body; try { body = await request.json(); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400 }); }
      try {
        if (!plan) throw new Error('NO_PLAN');
        const t = plan.tasks.find(x => x.id === body?.task);
        if (!t || t.assignee !== body?.person) throw new Error('STALE_OR_WRONG_ASSIGNMENT');
        const r = store.apply({ expectedRevision: plan.revision, operationId: `qr-${crypto.randomUUID().slice(0, 13)}`,
          change: { kind: 'record_acceptance', task: t.id, person: t.assignee, taskVersion: t.version, simulated: true } });
        await this.ctx.storage.put('plan', plan);
        return Response.json({ ok: true, revision: r.appliedRevision, status: r.current.status });
      } catch (e) { return Response.json({ error: e.message }, { status: 409 }); }
    }
    if (url.pathname === '/interpret') {
      // Optional language layer: Workers AI proposes 1-3 structured steps; the browser still routes each one through
      // the deterministic rules and the MCP tools. Any failure returns { fallback } and the keyword router takes over.
      let body; try { body = await request.json(); } catch { return Response.json({ fallback: 'BAD_JSON' }, { status: 400 }); }
      const used = (await this.ctx.storage.get('aiCalls')) ?? 0;
      const spend = async () => {
        if (used >= SESSION_CAP) return false;
        await this.ctx.storage.put('aiCalls', used + 1);
        const budget = this.env.SESSIONS.get(this.env.SESSIONS.idFromName(BUDGET));
        try { return (await (await budget.fetch('https://session/budget', { method: 'POST' })).json()).ok === true; } catch { return false; }
      };
      const out = await interpret({ ai: this.env.AI, text: body?.text, plan, lastPerson: typeof body?.lastPerson === 'string' ? body.lastPerson : null, spend });
      return Response.json(out, { headers: { 'cache-control': 'no-store' } });
    }
    const server = new McpServer({ name: 'open-tomorrow', version: '0.3.0' });
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
    if (url.pathname === '/helper')
      return new Response(HELPER_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', ...security } });
    const route = { '/mcp': '/mcp', '/reset': '/reset', '/api/summary': '/summary', '/api/accept': '/accept', '/api/interpret': '/interpret' }[url.pathname];
    if (route) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Cross-origin requests are not enabled for this demo.' }, { status: 403 });
      const session = url.searchParams.get('session') ?? '';
      if (!SESSION.test(session)) return Response.json({ error: 'A demo session id is required: /mcp?session=<8-64 letters, digits or dashes>' }, { status: 400 });
      if (url.pathname === '/reset' && request.method !== 'POST') return new Response(null, { status: 405 });
      if (url.pathname === '/mcp' && request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      if (url.pathname === '/api/accept' && request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      if (url.pathname === '/api/interpret' && (request.method !== 'POST' || Number(request.headers.get('content-length') ?? 0) > 4096)) return new Response(null, { status: request.method !== 'POST' ? 405 : 413, headers: { allow: 'POST' } });
      if (url.pathname === '/api/summary' && request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session));
      const r = await stub.fetch(new Request(new URL(route, 'https://session'), request));
      if (route === '/summary') { const h = new Headers(r.headers); h.set('cache-control', 'no-store'); return new Response(r.body, { status: r.status, headers: h }); }
      return r;
    }
    return new Response('Not found', { status: 404 });
  }
};

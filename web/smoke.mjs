// End-to-end check of a deployed (or local) Worker: real MCP client, full scripted flow, isolation and guards.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { florist } from '../fixture.mjs';
const base = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'http://127.0.0.1:8788';
const requireAI = process.argv.includes('--require-ai');
const session = `smoke-${Date.now()}`;
let version;
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}`, base), { fetch: async (u, o) => { const r = await fetch(u, o); if (String(o?.body).includes('"initialize"')) version = (await r.clone().json()).result?.protocolVersion; return r; } }));
assert.equal(version, '2025-11-25');
const { tools } = await client.listTools();
assert.equal(tools.length, 3);
// MCP Apps: every tool points at the same ui:// board view, served as an MCP App resource.
const uri = tools[0]._meta?.ui?.resourceUri;
assert.equal(uri, 'ui://open-tomorrow/board.html');
assert.ok(tools.every(t => t._meta?.ui?.resourceUri === uri));
const view = (await client.readResource({ uri })).contents[0];
assert.equal(view.mimeType, 'text/html;profile=mcp-app');
assert.match(view.text, /<div id="board"/);
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return r.isError ? { err: r.content[0].text } : (r.structuredContent.current ?? r.structuredContent); };
let s = await call('create_handover', { plan: florist }); assert.equal(s.nextAction.code, 'OVERLAP');
let n = 0; const ch = async c => (s = await call('change_handover', { expectedRevision: s.revision, operationId: `s${++n}`, change: c }));
await ch({ kind: 'assign', task: 'delivery', person: 'driver' }); assert.equal(s.nextAction.code, 'AWAITING_ACCEPTANCE');
for (const t of s.tasks) await ch({ kind: 'record_acceptance', task: t.id, person: t.assignee, taskVersion: t.version, simulated: true });
await ch({ kind: 'confirm_entered_scope', confirmed: true }); assert.equal(s.status, 'ENTERED_TASKS_COVERED');
const old = s.tasks[1].version;
await ch({ kind: 'cancel', person: 'driver' }); assert.deepEqual(s.uncoveredTasks, ['delivery']);
const stale = await call('change_handover', { expectedRevision: s.revision, operationId: 'stale', change: { kind: 'record_acceptance', task: 'delivery', person: 'driver', taskVersion: old, simulated: true } });
assert.match(stale.err, /STALE_OR_WRONG_ASSIGNMENT/);
// persistence across a fresh MCP connection
const c2 = new Client({ name: 'smoke2', version: '1' }); await c2.connect(new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}`, base)));
assert.equal((await c2.callTool({ name: 'check_coverage', arguments: {} })).structuredContent.revision, s.revision);
// isolation: another session has no plan
const c3 = new Client({ name: 'smoke3', version: '1' }); await c3.connect(new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}-other`, base)));
assert.match((await c3.callTool({ name: 'check_coverage', arguments: {} })).content[0].text, /NO_PLAN/);
// Workers AI layer: proposes steps for the keyword router, or says why it fell back. One model call per run.
const interpret = (sess, body) => fetch(new URL(`/api/interpret?session=${sess}`, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await fetch(new URL(`/api/interpret?session=${session}`, base))).status, 405);
assert.equal((await (await interpret(`${session}-other`, { text: 'Helper C can take it' })).json()).fallback, 'NO_PLAN');
const ai = await (await interpret(session, { text: 'Helper C can take the flowers run', lastPerson: null })).json();
if (ai.steps) assert.deepEqual(ai.steps.map(x => [x.action, x.person, x.task]), [['assign', 'spare', 'delivery']]);
else assert.ok(!requireAI, `AI layer fell back: ${ai.fallback}`);
const aiNote = ai.steps ? `AI ${ai.model.split('/').pop()} ${ai.ms} ms -> "${ai.steps[0].say}"` : `AI fallback ${ai.fallback}`;
// guards
assert.equal((await fetch(new URL('/mcp', base), { method: 'POST' })).status, 400);
assert.equal((await fetch(new URL(`/mcp?session=${session}`, base), { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
assert.equal((await fetch(new URL(`/reset?session=${session}`, base), { method: 'POST' })).status, 204);
assert.match((await c2.callTool({ name: 'check_coverage', arguments: {} })).content[0].text, /NO_PLAN/);
console.log(`SMOKE PASS ${base}: MCP ${version}, MCP App view, ${aiNote}, full flow, stale rejected, persistence, session isolation, origin/session guards, reset`);
for (const c of [client, c2, c3]) await c.close();

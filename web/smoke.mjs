// End-to-end check of a deployed (or local) Worker: real MCP client, full scripted flow, isolation and guards.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { florist } from '../fixture.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:8788';
const session = `smoke-${Date.now()}`;
let version;
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}`, base), { fetch: async (u, o) => { const r = await fetch(u, o); if (String(o?.body).includes('"initialize"')) version = (await r.clone().json()).result?.protocolVersion; return r; } }));
assert.equal(version, '2025-11-25');
assert.equal((await client.listTools()).tools.length, 3);
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
// guards
assert.equal((await fetch(new URL('/mcp', base), { method: 'POST' })).status, 400);
assert.equal((await fetch(new URL(`/mcp?session=${session}`, base), { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
assert.equal((await fetch(new URL(`/reset?session=${session}`, base), { method: 'POST' })).status, 204);
assert.match((await c2.callTool({ name: 'check_coverage', arguments: {} })).content[0].text, /NO_PLAN/);
console.log(`SMOKE PASS ${base}: MCP ${version}, full flow, stale rejected, persistence, session isolation, origin/session guards, reset`);
for (const c of [client, c2, c3]) await c.close();

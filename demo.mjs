import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { florist } from './fixture.mjs';

const directory = mkdtempSync(join(tmpdir(), 'open-tomorrow-demo-'));
const file = join(directory, 'plan.json');
async function startServer({ file }) {
  const child = fork(new URL('./proof-process.mjs', import.meta.url), [file], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const address = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Proof child exited before ready: ${code}`)));
  });
  return { ...address, close: () => new Promise((resolve, reject) => {
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Proof child exit ${code}`)));
    child.send('stop');
  }) };
}
let server = await startServer({ file });
const firstPid = server.pid;
let client = new Client({ name: 'open-tomorrow-proof-client', version: '0.1.0' });
const versions = new Set();
const connect = async () => client.connect(new StreamableHTTPClientTransport(new URL(server.url), {
  fetch: async (url, options) => {
    const response = await fetch(url, options);
    if (String(options?.body).includes('"method":"initialize"')) {
      const data = await response.clone().json();
      if (data.result?.protocolVersion) versions.add(data.result.protocolVersion);
    }
    return response;
  }
}));
await connect();
try {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 3);
  async function call(name, args) {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, r.content?.[0]?.text);
    return r.structuredContent ?? JSON.parse(r.content[0].text);
  }
  let state = await call('create_handover', { plan: florist });
  assert.ok(state.tasks[0].blockers.some(b => b.code === 'OVERLAP' && b.text.includes('08:30–09:00')));
  console.log('1. Actual MCP call: overlap blocks setup and delivery, 08:30–09:00.');
  let n = 0;
  async function change(change) { const r = await call('change_handover', { expectedRevision: state.revision, operationId: `demo-${++n}`, change }); state = r.current; return r; }
  await change({ kind: 'assign', task: 'delivery', person: 'driver' });
  assert.equal(state.status, 'NEEDS_ATTENTION');
  console.log('2. Reassigned delivery; assignment alone does not establish acceptance.');
  for (const task of state.tasks) await change({ kind: 'record_acceptance', task: task.id, person: task.assignee, taskVersion: task.version, simulated: true });
  assert.equal(state.status, 'NEEDS_ATTENTION');
  await change({ kind: 'confirm_entered_scope', confirmed: true });
  assert.equal(state.status, 'ENTERED_TASKS_COVERED');
  const priorSetup = structuredClone(state.tasks[0]);
  const oldDeliveryVersion = state.tasks[1].version;
  console.log('3. Only after simulated acceptance and scope confirmation: entered tasks covered.');
  await change({ kind: 'cancel', person: 'driver' });
  assert.deepEqual(state.uncoveredTasks, ['delivery']);
  assert.deepEqual(state.tasks[0], priorSetup);
  console.log('4. Helper B cancels: delivery reopens; Helper A setup and acceptance stay intact.');
  const stale = await client.callTool({ name: 'change_handover', arguments: { expectedRevision: state.revision, operationId: 'stale-acceptance', change: { kind: 'record_acceptance', task: 'delivery', person: 'driver', taskVersion: oldDeliveryVersion, simulated: true } } });
  assert.equal(stale.isError, true);
  console.log('5. Acceptance for the cancelled assignment is rejected.');
  await client.close(); await server.close();
  server = await startServer({ file });
  assert.notEqual(server.pid, firstPid);
  client = new Client({ name: 'open-tomorrow-restart-proof', version: '0.1.0' });
  await connect();
  const restored = await call('check_coverage', {});
  assert.deepEqual(restored, state);
  assert.ok(versions.has('2025-11-25'));
  console.log('6. Server restart: exact changed plan restored through a fresh MCP connection.');
  console.log(`PASS: actual Streamable HTTP; negotiated ${[...versions].join(', ')}. Fictional inputs; no model, Alexa device, employee contact or paid API call.`);
} finally { await client.close(); await server.close(); }

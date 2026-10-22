// MCP Apps wiring: each tool advertises the board view, the view is served with the MCP App MIME type, and the
// committed view bundle matches its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CoverageStore } from './coverage.mjs';
import { florist } from './fixture.mjs';
import { registerTools, BOARD_URI } from './tools.mjs';

async function connected() {
  let plan = null;
  const server = new McpServer({ name: 'open-tomorrow', version: 'test' });
  registerTools(server, new CoverageStore(null, { load: () => plan, save: p => { plan = p; } }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return client;
}

test('mcp apps: all three tools point at the board view, and the view is an MCP App resource', async () => {
  const client = await connected();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name), ['create_handover', 'check_coverage', 'change_handover']);
  for (const t of tools) assert.equal(t._meta?.ui?.resourceUri, BOARD_URI);
  assert.equal(tools.find(t => t.name === 'check_coverage').annotations.readOnlyHint, true);
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map(r => r.uri), [BOARD_URI]);
  const [view] = (await client.readResource({ uri: BOARD_URI })).contents;
  assert.equal(view.mimeType, 'text/html;profile=mcp-app');
  assert.match(view.text, /^<!doctype html>/);
  assert.match(view.text, /id="refresh"/);
  // Self-contained: no external scripts, styles or images; the host's sandbox and CSP decide network access.
  assert.doesNotMatch(view.text, /(src|href)\s*=\s*["']?https?:/i);
  await client.close();
});

test('mcp apps: tool results carry the people labels the card shows', async () => {
  const client = await connected();
  const r = await client.callTool({ name: 'create_handover', arguments: { plan: florist } });
  assert.deepEqual(r.structuredContent.people, [{ id: 'opener', label: 'Helper A' }, { id: 'driver', label: 'Helper B' }, { id: 'spare', label: 'Helper C' }]);
  await client.close();
});

test('mcp apps: the committed board view is built from the current source', () => {
  const r = spawnSync(process.execPath, [new URL('./web/build.mjs', import.meta.url).pathname, '--check-board'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

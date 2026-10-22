// The Agent Skill must stay valid (name/description frontmatter) and only mention tools and change kinds that exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../tools.mjs';

const text = readFileSync(new URL('./open-tomorrow/SKILL.md', import.meta.url), 'utf8');

test('agent skill: frontmatter follows the Agent Skills format', () => {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(fm, 'frontmatter');
  const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1].trim();
  assert.equal(name, 'open-tomorrow'); // must match the folder name
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64);
  assert.ok(description.length > 50 && description.length <= 1024);
});

test('agent skill: every tool, change kind and error it names is real', () => {
  const names = [];
  registerTools({ registerTool: n => names.push(n), registerResource: () => {} }, {});
  for (const t of text.match(/`(create_handover|check_coverage|change_handover|[a-z]+_[a-z_]+)`/g).map(s => s.slice(1, -1)))
    if (/_handover$|_coverage$/.test(t)) assert.ok(names.includes(t), t);
  assert.deepEqual(names.sort(), ['change_handover', 'check_coverage', 'create_handover']);
  const coverage = readFileSync(new URL('../coverage.mjs', import.meta.url), 'utf8');
  for (const kind of ['assign', 'record_acceptance', 'cancel', 'retime', 'confirm_entered_scope']) {
    assert.match(text, new RegExp('`' + kind + '`'));
    assert.match(coverage, new RegExp(`'${kind}'`), kind);
  }
  for (const code of ['PLAN_EXISTS', 'STALE_REVISION', 'STALE_OR_WRONG_ASSIGNMENT', 'ENTERED_TASKS_COVERED']) assert.match(coverage, new RegExp(code), code);
  assert.match(text, /ui:\/\/open-tomorrow\/board\.html/);
});

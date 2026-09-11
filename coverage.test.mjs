import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoverageStore, Plan, assess } from './coverage.mjs';
import { florist } from './fixture.mjs';

const make = () => { const file = join(mkdtempSync(join(tmpdir(), 'open-tomorrow-test-')), 'plan.json'); const s = new CoverageStore(file); s.create(florist); return s; };
const apply = (s, change, operationId = `op-${s.state.revision}`) => s.apply({ expectedRevision: s.state.revision, operationId, change });
const complete = s => {
  apply(s, { kind: 'assign', task: 'delivery', person: 'driver' });
  for (const t of s.state.tasks) apply(s, { kind: 'record_acceptance', task: t.id, person: t.assignee, taskVersion: t.version, simulated: true });
  apply(s, { kind: 'confirm_entered_scope', confirmed: true });
};
test('empty, duplicate, impossible dates, inverted times and unknown assignees reject', () => {
  for (const bad of [ { ...florist, tasks: [] }, { ...florist, date: '2026-02-30' }, { ...florist, people: [...florist.people, florist.people[0]] }, { ...florist, tasks: [{ ...florist.tasks[0], end: 1 }] }, { ...florist, tasks: [{ ...florist.tasks[0], assignee: 'nobody' }] } ]) assert.equal(Plan.safeParse(bad).success, false);
});
test('exact overlap and acceptance blockers; adjacent tasks do not overlap', () => {
  const s = make(); assert.ok(s.read().tasks[0].blockers.some(b => b.text.includes('08:30–09:00')));
  apply(s, { kind: 'retime', task: 'delivery', start: 540, end: 585 });
  assert.ok(s.read().tasks.every(t => !t.blockers.some(b => b.code === 'OVERLAP')));
  assert.ok(s.read().tasks.every(t => t.blockers.some(b => b.code === 'AWAITING_ACCEPTANCE')));
});
test('scope confirmation and acceptance are both necessary, acceptance is simulated', () => {
  const s = make(); complete(s); assert.equal(s.read().status, 'ENTERED_TASKS_COVERED');
  const p = structuredClone(s.state); p.scopeConfirmed = false; assert.equal(assess(p).status, 'NEEDS_ATTENTION');
  p.scopeConfirmed = true; p.tasks[0].acceptance = null; assert.equal(assess(p).status, 'NEEDS_ATTENTION');
  assert.throws(() => apply(s, { kind: 'record_acceptance', task: 'setup', person: 'opener', taskVersion: 1, simulated: false }));
});
test('cancellation changes only affected task; stale acceptance and reassignment cannot restore readiness', () => {
  const s = make(); complete(s); const setup = structuredClone(s.state.tasks[0]); const version = s.state.tasks[1].version;
  apply(s, { kind: 'cancel', person: 'driver' });
  assert.deepEqual(s.read().uncoveredTasks, ['delivery']); assert.deepEqual(s.state.tasks[0], setup);
  assert.throws(() => apply(s, { kind: 'record_acceptance', task: 'delivery', person: 'driver', taskVersion: version, simulated: true }), /STALE_OR_WRONG/);
  apply(s, { kind: 'assign', task: 'delivery', person: 'driver' });
  assert.ok(s.read().tasks[1].blockers.some(b => b.code === 'UNAVAILABLE'));
});
test('same operation retry is idempotent; reused ID with changed input and stale revision cannot write', () => {
  const s = make(); const args = { expectedRevision: 1, operationId: 'retry', change: { kind: 'assign', task: 'delivery', person: 'driver' } };
  s.apply(args); const bytes = readFileSync(s.file, 'utf8'); assert.equal(s.apply(args).replayed, true);
  assert.throws(() => s.apply({ ...args, change: { kind: 'cancel', person: 'driver' } }), /OPERATION_ID_REUSED/);
  assert.throws(() => s.apply({ ...args, operationId: 'late' }), /STALE_REVISION/);
  assert.equal(readFileSync(s.file, 'utf8'), bytes);
});
test('inherited object key is a valid fresh operation ID and becomes an own recorded operation', () => {
  const s = make();
  const args = { expectedRevision: 1, operationId: 'constructor', change: { kind: 'assign', task: 'delivery', person: 'driver' } };
  assert.equal(s.apply(args).replayed, false);
  assert.equal(s.apply(args).replayed, true);
  assert.equal(s.state.revision, 2);
});
test('retiming invalidates only its acceptance and resets scope; reinitialize never overwrites', () => {
  const s = make(); complete(s); const setup = structuredClone(s.state.tasks[0]);
  apply(s, { kind: 'retime', task: 'delivery', start: 560, end: 600 });
  assert.equal(s.state.tasks[1].acceptance, null); assert.equal(s.state.scopeConfirmed, false); assert.deepEqual(s.state.tasks[0], setup);
  assert.throws(() => s.create(florist), /PLAN_EXISTS/);
  assert.deepEqual(new CoverageStore(s.file).read(), s.read());
});
test('negative control catches missing cancellation propagation', () => {
  const s = make(); complete(s); const before = structuredClone(s.state);
  apply(s, { kind: 'cancel', person: 'driver' });
  const oracle = report => assert.deepEqual(report.uncoveredTasks, ['delivery']);
  oracle(s.read());
  // Mutant simulates a handler that logs cancellation but leaves coverage state untouched.
  before.history.push({ kind: 'cancel', touchedTasks: [], revision: before.revision + 1 });
  assert.throws(() => oracle(assess(before)), { name: 'AssertionError' });
});

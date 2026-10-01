import * as z from 'zod/v4';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const minute = z.number().int().min(0).max(1440);
const window = z.object({ start: minute, end: minute }).refine(x => x.start < x.end, 'Start must precede end');
export const Plan = z.object({
  title: z.string().trim().min(1).max(100),
  date: z.iso.date(),
  people: z.array(z.object({ id, label: z.string().trim().min(1).max(60), available: z.array(window).max(10) })).min(1).max(20),
  tasks: z.array(z.object({ id, label: z.string().trim().min(1).max(100), start: minute, end: minute, assignee: id.nullable() })
    .refine(x => x.start < x.end, 'Start must precede end')).min(1).max(50)
}).superRefine((p, ctx) => {
  for (const field of ['people', 'tasks']) if (new Set(p[field].map(x => x.id)).size !== p[field].length)
    ctx.addIssue({ code: 'custom', message: `Duplicate ${field} ID` });
  for (const task of p.tasks) if (task.assignee && !p.people.some(p => p.id === task.assignee))
    ctx.addIssue({ code: 'custom', message: `Unknown assignee on ${task.id}` });
});
export const Change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assign'), task: id, person: id }),
  z.object({ kind: z.literal('record_acceptance'), task: id, person: id, taskVersion: z.number().int().positive(), simulated: z.literal(true) }),
  z.object({ kind: z.literal('cancel'), person: id }),
  z.object({ kind: z.literal('retime'), task: id, start: minute, end: minute }).refine(x => x.start < x.end),
  z.object({ kind: z.literal('confirm_entered_scope'), confirmed: z.literal(true) })
]);
const hhmm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function assess(state) {
  const tasks = state.tasks.map(task => {
    const blockers = [];
    const person = state.people.find(p => p.id === task.assignee);
    if (!person) blockers.push({ code: 'UNASSIGNED', text: 'No helper assigned' });
    else {
      if (!person.available.some(w => w.start <= task.start && w.end >= task.end))
        blockers.push({ code: 'UNAVAILABLE', text: `${person.label} is not available for the whole task` });
      for (const other of state.tasks) if (other.id !== task.id && other.assignee === person.id && task.start < other.end && other.start < task.end)
        blockers.push({ code: 'OVERLAP', with: other.id, text: `Overlaps ${other.label}, ${hhmm(Math.max(task.start, other.start))}–${hhmm(Math.min(task.end, other.end))}` });
      if (!task.acceptance || task.acceptance.person !== person.id || task.acceptance.taskVersion !== task.version)
        blockers.push({ code: 'AWAITING_ACCEPTANCE', text: 'Assignment is not acceptance' });
    }
    return { ...task, blockers, covered: blockers.length === 0 };
  });
  const complete = tasks.length > 0 && tasks.every(t => t.covered) && state.scopeConfirmed;
  const firstStructural = tasks.map(task => ({ task, blocker: task.blockers.find(b => b.code !== 'AWAITING_ACCEPTANCE') }))
    .find(x => x.blocker);
  const firstPending = tasks.map(task => ({ task, blocker: task.blockers.find(b => b.code === 'AWAITING_ACCEPTANCE') }))
    .find(x => x.blocker);
  const selected = firstStructural ?? firstPending;
  const firstUncovered = selected?.task;
  const firstBlocker = selected?.blocker;
  let nextAction = null;
  if (firstBlocker?.code === 'UNASSIGNED') nextAction = {
    code: 'UNASSIGNED', task: firstUncovered.id,
    text: `Assign ${firstUncovered.id} to an available helper; no prior acceptance carries over.`
  };
  else if (firstBlocker?.code === 'UNAVAILABLE') nextAction = {
    code: 'UNAVAILABLE', task: firstUncovered.id,
    text: `Retime or reassign ${firstUncovered.id}; its assigned helper is not available for the whole task.`
  };
  else if (firstBlocker?.code === 'OVERLAP') nextAction = {
    code: 'OVERLAP', task: firstUncovered.id,
    text: `Resolve ${firstUncovered.id} overlap with ${firstBlocker.with} before recording simulated acceptance.`
  };
  else if (firstBlocker?.code === 'AWAITING_ACCEPTANCE') nextAction = {
    code: 'AWAITING_ACCEPTANCE', task: firstUncovered.id,
    text: `Record simulated acceptance for ${firstUncovered.id} from its assigned helper and exact task version; no real helper is contacted.`
  };
  else if (!state.scopeConfirmed) nextAction = {
    code: 'CONFIRM_ENTERED_SCOPE', task: null,
    text: 'Review whether any duties were omitted, then confirm only the entered scope; this does not verify real-world coverage.'
  };
  return { title: state.title, date: state.date, revision: state.revision,
    status: complete ? 'ENTERED_TASKS_COVERED' : 'NEEDS_ATTENTION',
    statement: complete ? 'All entered tasks have simulated accepted coverage.' : 'The entered handover still needs attention.',
    scopeConfirmed: state.scopeConfirmed, uncoveredTasks: tasks.filter(t => !t.covered).map(t => t.id), nextAction,
    tasks, lastChange: state.history.at(-1) ?? null,
    limitations: ['Fictional shop and simulated helper actions only.', 'This does not verify omitted duties, real employee acceptance, staffing law, travel time or business safety.', 'No messages, calendar changes or employment commitments are sent.'] };
}

export class CoverageStore {
  constructor(file) { this.file = file; this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; }
  save(next) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.state = next;
  }
  create(input) {
    if (this.state) throw new Error('PLAN_EXISTS: use the existing plan; initialization never overwrites it');
    const p = Plan.parse(input);
    this.save({ ...p, revision: 1, scopeConfirmed: false,
      tasks: p.tasks.map(t => ({ ...t, version: 1, acceptance: null })), history: [], operations: {} });
    return this.read();
  }
  read() { if (!this.state) throw new Error('NO_PLAN'); return assess(this.state); }
  apply({ expectedRevision, operationId, change: input }) {
    if (!this.state) throw new Error('NO_PLAN');
    const change = Change.parse(input);
    const fingerprint = createHash('sha256').update(JSON.stringify({ expectedRevision, change })).digest('hex');
    const prior = Object.hasOwn(this.state.operations, operationId) ? this.state.operations[operationId] : undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error('OPERATION_ID_REUSED_WITH_DIFFERENT_INPUT');
      return { replayed: true, appliedRevision: prior.appliedRevision, current: this.read() };
    }
    if (this.state.revision !== expectedRevision) throw new Error('STALE_REVISION: read current state before making another change');
    if (this.state.history.length >= 500) throw new Error('DEMO_LIMIT: maximum 500 mutations');
    const next = structuredClone(this.state);
    const touched = [];
    const task = next.tasks.find(t => t.id === change.task);
    const invalidate = t => { t.version += 1; t.acceptance = null; touched.push(t.id); };
    if (['assign', 'record_acceptance', 'retime'].includes(change.kind) && !task) throw new Error('UNKNOWN_TASK');
    if (['assign', 'record_acceptance', 'cancel'].includes(change.kind) && !next.people.some(p => p.id === change.person)) throw new Error('UNKNOWN_PERSON');
    if (change.kind === 'assign') {
      if (task.assignee !== change.person) { task.assignee = change.person; invalidate(task); }
    } else if (change.kind === 'record_acceptance') {
      if (task.assignee !== change.person || task.version !== change.taskVersion) throw new Error('STALE_OR_WRONG_ASSIGNMENT');
      task.acceptance = { person: change.person, taskVersion: task.version, source: 'SIMULATED_HELPER_ACTION' };
      touched.push(task.id);
    } else if (change.kind === 'cancel') {
      for (const t of next.tasks) if (t.assignee === change.person) { t.assignee = null; invalidate(t); }
      next.people.find(p => p.id === change.person).available = [];
    } else if (change.kind === 'retime') {
      if (task.start !== change.start || task.end !== change.end) { task.start = change.start; task.end = change.end; invalidate(task); next.scopeConfirmed = false; }
    } else if (change.kind === 'confirm_entered_scope') next.scopeConfirmed = true;
    next.revision += 1;
    next.history.push({ kind: change.kind, revision: next.revision, touchedTasks: touched });
    next.operations[operationId] = { fingerprint, appliedRevision: next.revision };
    this.save(next);
    return { replayed: false, appliedRevision: next.revision, current: this.read() };
  }
}

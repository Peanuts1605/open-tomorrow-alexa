// Workers AI layer: the model may only propose known actions on known ids; everything else falls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { florist } from '../fixture.mjs';
import { ACTIONS, DAILY_CAP, contextFrom, buildMessages, parseSteps, mentioned, canonical, routesTo, interpret, stepsSchema } from './ai.mjs';
import { classify } from './intent.mjs';

const ctx = (text = '', last = null) => ({ ...contextFrom(florist, last), text });
const fakeAI = reply => ({ calls: 0, async run(model, input) { this.calls++; this.input = input; this.model = model; return typeof reply === 'function' ? reply(input) : reply; } });
const yes = async () => true;

test('ai: the context gives the model ids and names only, and the cost cap stays under the free allocation', () => {
  const c = contextFrom(florist, 'driver');
  assert.deepEqual(c.people.map(p => p.id), ['opener', 'driver', 'spare']);
  assert.deepEqual(Object.keys(c.tasks[0]).sort(), ['assignee', 'id', 'name', 'time']);
  assert.equal(c.lastPerson, 'driver');
  assert.equal(contextFrom(florist, 'nobody').lastPerson, null);
  const [sys, user] = buildMessages('x'.repeat(500), c);
  assert.equal(sys.role, 'system'); assert.ok(user.content.length <= 240);
  assert.deepEqual(stepsSchema.properties.steps.items.properties.action.enum, ACTIONS);
  // 20 neurons per call (measured upper bound) x the daily cap must stay well below 10,000 free neurons a day.
  assert.ok(DAILY_CAP * 20 <= 5000);
});

test('ai: parseSteps accepts valid steps in several shapes and rejects anything off-plan', () => {
  const c = ctx('Helper B is sick, give the delivery to Helper C');
  const two = { steps: [{ action: 'cancel', person: 'driver', task: null }, { action: 'assign', person: 'spare', task: 'delivery' }] };
  assert.deepEqual(parseSteps(two, c).steps, two.steps);
  assert.deepEqual(parseSteps(`Sure! ${JSON.stringify(two)}`, c).steps, two.steps);
  assert.deepEqual(parseSteps(two.steps, c).steps, two.steps);
  assert.deepEqual(parseSteps({ action: 'cancel', person: 'driver', task: 'null' }, c).steps, [{ action: 'cancel', person: 'driver', task: null }]);
  assert.equal(parseSteps('not json', c).error, 'NOT_JSON');
  assert.equal(parseSteps({ steps: [] }, c).error, 'NO_STEPS');
  assert.equal(parseSteps({ steps: [{ action: 'delete_plan', person: null, task: null }] }, c).error, 'BAD_ACTION');
  assert.equal(parseSteps({ steps: [{ action: 'cancel', person: 'boss', task: null }] }, c).error, 'UNKNOWN_PERSON');
  assert.equal(parseSteps({ steps: [{ action: 'assign', person: 'spare', task: 'payroll' }] }, c).error, 'UNKNOWN_TASK');
  assert.equal(parseSteps({ steps: [{ action: 'accept', person: null, task: 'setup' }] }, c).error, 'MISSING_PERSON');
  assert.equal(parseSteps({ steps: [{ action: 'unknown', person: null, task: null }] }, c).error, 'UNKNOWN_INTENT');
  // At most three steps; unknown steps are dropped, real ones kept.
  const many = { steps: [...Array(5)].map(() => ({ action: 'status', person: null, task: null })) };
  assert.equal(parseSteps(many, c).steps.length, 3);
  assert.deepEqual(parseSteps({ steps: [{ action: 'unknown', person: null, task: null }, { action: 'status', person: null, task: null }] }, c).steps, [{ action: 'status', person: null, task: null }]);
});

test('ai: a step about a helper the owner did not name is refused (wrong-person guard)', () => {
  const c = ctx('Helper C can take the flowers');
  assert.equal(parseSteps({ steps: [{ action: 'assign', person: 'driver', task: 'delivery' }] }, c).error, 'PERSON_MISMATCH');
  assert.equal(parseSteps({ steps: [{ action: 'assign', person: 'spare', task: 'delivery' }] }, c).steps.length, 1);
  // Pronouns: nobody named, so lastPerson-style answers are allowed.
  assert.equal(parseSteps({ steps: [{ action: 'cancel', person: 'driver', task: null }] }, ctx('they can’t make it', 'driver')).steps.length, 1);
  const people = contextFrom(florist).people;
  assert.deepEqual([...mentioned('helper b and Helper C', people)].sort(), ['driver', 'spare']);
  assert.deepEqual([...mentioned("B's out, can C cover?", people)].sort(), ['driver', 'spare']);
  assert.deepEqual([...mentioned('a quick question about the van', people)], []);
});

test('ai: every valid step becomes a sentence the keyword router classifies the same way', () => {
  const c = ctx();
  for (const action of ['cancel', 'accept', 'assign', 'confirm_scope', 'who_free', 'status'])
    for (const person of action.match(/cancel|accept|assign/) ? c.people.map(p => p.id) : [null])
      for (const task of action.match(/accept|assign/) ? [null, ...c.tasks.map(t => t.id)] : [null]) {
        const step = { action, person, task };
        assert.ok(routesTo(step, c), `${JSON.stringify(step)} -> ${canonical(step, c)}`);
      }
  assert.equal(canonical({ action: 'assign', person: 'spare', task: 'delivery' }, c), 'Give "Deliver the morning flowers" to Helper C.');
  assert.equal(canonical({ action: 'unknown', person: null, task: null }, c), null);
  assert.equal(classify('Helper B can’t come'), 'cancel');
  assert.equal(classify('Give it to Helper C', { hasPerson: true }), 'assign');
  assert.equal(classify('Give it to Helper C'), 'unknown');
  assert.equal(classify('yes', { awaitingScope: true }), 'confirm_scope');
  assert.equal(classify('Who’s free?'), 'who_free');
});

test('ai: interpret returns checked steps from the model, with the say-sentence for the router', async () => {
  const ai = fakeAI({ response: { steps: [{ action: 'cancel', person: 'driver', task: null }, { action: 'assign', person: 'spare', task: 'delivery' }] } });
  const r = await interpret({ ai, text: 'Helper B is sick, so Helper C takes the flowers', plan: florist, lastPerson: null, spend: yes });
  assert.deepEqual(r.steps.map(s => s.say), ["Helper B can't come.", 'Give "Deliver the morning flowers" to Helper C.']);
  assert.equal(ai.calls, 1);
  assert.equal(ai.input.temperature, 0);
  assert.equal(ai.input.response_format.type, 'json_schema');
  assert.match(r.model, /llama-3\.3-70b/);
  // Workers AI may also return the JSON as a string.
  const s = await interpret({ ai: fakeAI({ response: '{"steps":[{"action":"who_free","person":null,"task":null}]}' }), text: 'anyone around?', plan: florist, spend: yes });
  assert.deepEqual(s.steps.map(x => x.say), ["Who's free?"]);
});

test('ai: interpret falls back (and never calls the model) when it should not spend', async () => {
  const ai = fakeAI({ response: { steps: [{ action: 'status', person: null, task: null }] } });
  assert.equal((await interpret({ ai, text: '  ', plan: florist, spend: yes })).fallback, 'EMPTY');
  assert.equal((await interpret({ ai, text: 'x'.repeat(241), plan: florist, spend: yes })).fallback, 'TOO_LONG');
  assert.equal((await interpret({ ai, text: 'status?', plan: null, spend: yes })).fallback, 'NO_PLAN');
  assert.equal((await interpret({ ai: undefined, text: 'status?', plan: florist, spend: yes })).fallback, 'AI_UNAVAILABLE');
  assert.equal((await interpret({ ai, text: 'status?', plan: florist, spend: async () => false })).fallback, 'DAILY_BUDGET_USED');
  assert.equal(ai.calls, 0);
});

test('ai: interpret falls back on model errors, timeouts, junk and wrong people', async () => {
  const boom = { run: async () => { throw new Error('3036: daily free allocation exceeded'); } };
  assert.equal((await interpret({ ai: boom, text: 'status?', plan: florist, spend: yes })).fallback, 'AI_ERROR');
  const slow = { run: () => new Promise(r => setTimeout(() => r({ response: { steps: [] } }), 200)) };
  assert.equal((await interpret({ ai: slow, text: 'status?', plan: florist, spend: yes, timeoutMs: 20 })).fallback, 'TIMEOUT');
  assert.equal((await interpret({ ai: fakeAI({ response: 'I think Helper C should do it' }), text: 'hm', plan: florist, spend: yes })).fallback, 'NOT_JSON');
  const wrong = fakeAI({ response: { steps: [{ action: 'accept', person: 'opener', task: 'setup' }] } });
  assert.equal((await interpret({ ai: wrong, text: 'Helper C said yes', plan: florist, spend: yes })).fallback, 'PERSON_MISMATCH');
});

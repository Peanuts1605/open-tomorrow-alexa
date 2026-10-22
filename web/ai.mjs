// Workers AI intent layer: "the model proposes, the rules decide".
// A small model turns free speech into at most three constrained steps (an enum action plus plan IDs).
// Each step becomes a canonical sentence for the deterministic router in web/client.mjs, which calls the
// MCP tools; the coverage rules (coverage.mjs) still decide what counts. The model never writes to the plan,
// never sees helper contact details (there are none), and anything invalid falls back to the keyword router.
import { classify } from './intent.mjs';

export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const ACTIONS = ['cancel', 'accept', 'assign', 'confirm_scope', 'who_free', 'status', 'unknown'];
export const MAX_TEXT = 240;
export const MAX_STEPS = 3;
// Cost guard. Measured on this prompt: ~380 input + ~20-40 output tokens = 15-20 neurons per call. A hard cap of
// 250 calls per UTC day is at most ~5,000 neurons, half the 10,000-neuron free daily allocation, so the cost is $0
// on any plan. Past the cap (or on any error) the page silently uses the keyword router.
export const DAILY_CAP = 250;
export const SESSION_CAP = 40;
export const TIMEOUT_MS = 6000;

export const stepsSchema = {
  type: 'object',
  properties: {
    steps: {
      type: 'array', minItems: 1, maxItems: MAX_STEPS,
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS },
          person: { type: ['string', 'null'] },
          task: { type: ['string', 'null'] }
        },
        required: ['action', 'person', 'task']
      }
    }
  },
  required: ['steps']
};

const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Only plan facts the model needs; IDs are what it must answer with.
export function contextFrom(plan, lastPerson = null) {
  const people = (plan?.people ?? []).map(p => ({ id: p.id, name: p.label }));
  const tasks = (plan?.tasks ?? []).map(t => ({ id: t.id, name: t.label, time: `${clock(t.start)}-${clock(t.end)}`, assignee: t.assignee ?? null }));
  return { people, tasks, lastPerson: people.some(p => p.id === lastPerson) ? lastPerson : null };
}

export function buildMessages(text, ctx) {
  const system = [
    'You map what a small-business owner says to a voice assistant into steps for a staffing handover tool.',
    'Reply with JSON only: {"steps":[{"action":...,"person":...,"task":...}]}, one to three steps, in the order they should happen.',
    'Actions:',
    '- cancel: a helper can no longer come or work (person required).',
    '- accept: a helper agreed to / said yes to / accepted a task (person required, task if named).',
    '- assign: give, hand over or move a task to a helper; "X can take it" (person required, task if named).',
    '- confirm_scope: the owner says the task list is complete ("that is everything", "nothing else").',
    '- who_free: the owner asks who is free or available.',
    '- status: the owner asks whether things are covered, what is left, or where things stand.',
    '- unknown: anything else, including chit-chat or requests the tool cannot do.',
    'Use only the person and task ids listed below, or null. Never invent ids. "they/she/he" means lastPerson.',
    'Only return steps the owner actually stated. Never add a step they did not say: a helper being sick is only cancel;',
    'a helper taking a task is only assign. Return cancel then assign only when the owner says both in the same sentence.',
    `People: ${JSON.stringify(ctx.people)}`,
    `Tasks: ${JSON.stringify(ctx.tasks)}`,
    `lastPerson: ${JSON.stringify(ctx.lastPerson)}`
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: String(text).slice(0, MAX_TEXT) }];
}

// Validate the model's JSON against the plan. Returns { steps } or { error }.
export function parseSteps(raw, ctx) {
  let data = raw;
  if (typeof data === 'string') {
    const m = data.match(/\{[\s\S]*\}/);
    try { data = JSON.parse(m ? m[0] : data); } catch { return { error: 'NOT_JSON' }; }
  }
  if (Array.isArray(data)) data = { steps: data };
  if (data && !data.steps && data.action) data = { steps: [data] };
  if (!data || !Array.isArray(data.steps) || data.steps.length < 1) return { error: 'NO_STEPS' };
  const people = new Set(ctx.people.map(p => p.id)), tasks = new Set(ctx.tasks.map(t => t.id));
  const steps = [];
  for (const s of data.steps.slice(0, MAX_STEPS)) {
    if (!s || !ACTIONS.includes(s.action)) return { error: 'BAD_ACTION' };
    const person = s.person == null || s.person === '' || s.person === 'null' ? null : String(s.person);
    const task = s.task == null || s.task === '' || s.task === 'null' ? null : String(s.task);
    if (person !== null && !people.has(person)) return { error: 'UNKNOWN_PERSON' };
    if (task !== null && !tasks.has(task)) return { error: 'UNKNOWN_TASK' };
    if (['cancel', 'accept', 'assign'].includes(s.action) && !person) return { error: 'MISSING_PERSON' };
    steps.push({ action: s.action, person, task });
  }
  if (steps.every(s => s.action === 'unknown')) return { error: 'UNKNOWN_INTENT' };
  // If the owner named helpers, every step must be about one of them (pronouns only count when nobody is named).
  const named = mentioned(ctx.text ?? '', ctx.people);
  if (named.size && steps.some(s => s.person && !named.has(s.person))) return { error: 'PERSON_MISMATCH' };
  return { steps: steps.filter(s => s.action !== 'unknown') };
}

// Helpers named in the raw text: "Helper B", or a capital letter standing alone ("B's out", "can C cover").
export function mentioned(text, people) {
  const out = new Set();
  for (const p of people) {
    const letter = p.name.match(/^helper\s+([a-z])$/i)?.[1];
    const hit = letter ? new RegExp(`\\bhelper\\s*${letter}\\b`, 'i').test(text) || new RegExp(`(^|[^A-Za-z'])${letter.toUpperCase()}(?![A-Za-z])`).test(text)
      : text.toLowerCase().includes(p.name.toLowerCase());
    if (hit) out.add(p.id);
  }
  return out;
}

// Turn a validated step into the sentence the deterministic router already understands.
export function canonical(step, ctx) {
  const who = ctx.people.find(p => p.id === step.person)?.name;
  const what = ctx.tasks.find(t => t.id === step.task)?.name;
  switch (step.action) {
    case 'cancel': return `${who} can't come.`;
    case 'accept': return what ? `${who} said yes to "${what}".` : `${who} said yes.`;
    case 'assign': return what ? `Give "${what}" to ${who}.` : `Give it to ${who}.`;
    case 'confirm_scope': return "That's everything.";
    case 'who_free': return "Who's free?";
    case 'status': return 'Where do we stand?';
    default: return null;
  }
}

// Self-check: the canonical sentence must route to the same action. Guards against label words tripping regexes.
export function routesTo(step, ctx) {
  const s = canonical(step, ctx);
  return s !== null && classify(s, { hasPerson: Boolean(step.person) }) === step.action;
}

export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// Pure handler used by the Worker's Durable Object. `ai` is env.AI (or a fake in tests); `spend()` reserves one
// call from the global daily budget and resolves false when the day's cap is used up.
export async function interpret({ ai, text, plan, lastPerson, spend, timeoutMs = TIMEOUT_MS, model = AI_MODEL }) {
  const t0 = Date.now();
  const done = (body) => ({ ...body, model, ms: Date.now() - t0 });
  if (typeof text !== 'string' || !text.trim()) return done({ fallback: 'EMPTY' });
  if (text.length > MAX_TEXT) return done({ fallback: 'TOO_LONG' });
  if (!plan) return done({ fallback: 'NO_PLAN' });
  if (!ai) return done({ fallback: 'AI_UNAVAILABLE' });
  if (!(await spend())) return done({ fallback: 'DAILY_BUDGET_USED' });
  const ctx = { ...contextFrom(plan, lastPerson), text };
  let out;
  try {
    let timer;
    out = await Promise.race([
      ai.run(model, { messages: buildMessages(text, ctx), response_format: { type: 'json_schema', json_schema: stepsSchema }, max_tokens: 160, temperature: 0 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); })
    ]).finally(() => clearTimeout(timer));
  } catch (e) {
    return done({ fallback: e?.message === 'TIMEOUT' ? 'TIMEOUT' : 'AI_ERROR' });
  }
  const parsed = parseSteps(out?.response ?? out, ctx);
  if (parsed.error) return done({ fallback: parsed.error });
  if (!parsed.steps.every(s => routesTo(s, ctx))) return done({ fallback: 'UNROUTABLE' });
  return done({ steps: parsed.steps.map(s => ({ ...s, say: canonical(s, ctx) })) });
}

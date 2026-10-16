// Browser side: a real MCP client (official SDK) driving a scripted Alexa+-style conversation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { florist } from '../fixture.mjs';

const $ = s => document.querySelector(s);
const hhmm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const say = n => { const h = Math.floor(n / 60), m = n % 60; return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newSession = () => crypto.randomUUID();
let session = sessionStorage.getItem('ot-session') || newSession();
sessionStorage.setItem('ot-session', session);

let client, protocol = '', state = null, op = 0, step = 0, busy = false, auto = false;
let voice = false;

async function connect() {
  client = new Client({ name: 'alexa-plus-simulator', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}`, location.origin), {
    fetch: async (url, options) => {
      const r = await fetch(url, options);
      if (String(options?.body).includes('"method":"initialize"')) {
        try { protocol = (await r.clone().json()).result?.protocolVersion ?? ''; } catch {}
      }
      return r;
    }
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  $('#proto').textContent = `MCP ${protocol} · Streamable HTTP · ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`;
}

async function call(name, args) {
  const entry = wire(name, args);
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = Math.round(performance.now() - t0);
  const value = r.isError ? null : (r.structuredContent ?? JSON.parse(r.content[0].text));
  finishWire(entry, r, value, ms);
  if (value) state = value.current ?? value;
  render();
  return { error: r.isError ? r.content?.[0]?.text : null, value };
}
const change = c => call('change_handover', { expectedRevision: state.revision, operationId: `alexa-${session.slice(0, 8)}-${++op}`, change: c });
const person = id => state?.tasks && florist.people.find(p => p.id === id)?.label;
const task = id => state.tasks.find(t => t.id === id);

function explain() {
  if (state.status === 'ENTERED_TASKS_COVERED')
    return 'You’re covered for the tasks you gave me. Both helpers accepted, and you confirmed that’s the full list. I can’t vouch for anything you didn’t mention.';
  const n = state.nextAction;
  if (n.code === 'OVERLAP') {
    const t = task(n.task), b = t.blockers.find(x => x.code === 'OVERLAP'), o = task(b.with);
    return `Not yet. ${person(t.assignee)} is down for “${t.label.toLowerCase()}” and “${o.label.toLowerCase()}”, and those overlap from ${say(Math.max(t.start, o.start))} to ${say(Math.min(t.end, o.end))}. Want to move one of them?`;
  }
  if (n.code === 'AWAITING_ACCEPTANCE') {
    const waiting = state.tasks.filter(t => t.blockers.some(b => b.code === 'AWAITING_ACCEPTANCE'));
    return `Better. No more clashes. But ${waiting.map(t => `${person(t.assignee)} hasn’t accepted “${t.label.toLowerCase()}”`).join(', and ')} yet. Assigned isn’t the same as agreed.`;
  }
  if (n.code === 'CONFIRM_ENTERED_SCOPE') return 'Both helpers have accepted. One last check: is that every task for Saturday? I can only vouch for what you’ve told me.';
  if (n.code === 'UNASSIGNED') return `“${task(n.task).label}” has nobody now. ${state.tasks.filter(t => t.covered).map(t => `“${t.label}” is still fine with ${person(t.assignee)}`).join('. ')}. Who should take it?`;
  if (n.code === 'UNAVAILABLE') return `${person(task(n.task).assignee)} isn’t free for all of “${task(n.task).label.toLowerCase()}”.`;
  return state.statement;
}

const turns = [
  { you: 'Alexa, I’m off on Saturday. Ask Open Tomorrow if the flower shop is covered.',
    run: async () => { const r = await call('create_handover', { plan: florist }); return r.error?.startsWith('PLAN_EXISTS') ? (await call('check_coverage', {}), explain()) : explain(); } },
  { you: 'Give the delivery to Helper B.', run: async () => { await change({ kind: 'assign', task: 'delivery', person: 'driver' }); return explain(); } },
  { you: 'They both just said yes.', run: async () => {
      for (const t of state.tasks) if (t.assignee && !t.covered) await change({ kind: 'record_acceptance', task: t.id, person: t.assignee, taskVersion: t.version, simulated: true });
      return explain(); } },
  { you: 'Yes, that’s everything.', run: async () => { await change({ kind: 'confirm_entered_scope', confirmed: true }); return explain(); } },
  { you: 'Uh-oh. Helper B just cancelled.', run: async () => { await change({ kind: 'cancel', person: 'driver' }); return explain(); } },
  { you: 'Helper B says the delivery is fine after all. Their old yes still counts, right?', run: async () => {
      const r = await change({ kind: 'record_acceptance', task: 'delivery', person: 'driver', taskVersion: Math.max(1, task('delivery').version - 1), simulated: true });
      return r.error ? 'No. That yes was for the cancelled assignment, so I won’t count it. Helper B has also been marked unavailable, so the delivery needs a new helper and a fresh yes.' : explain(); } },
  { you: 'Alexa, where do we stand?', run: async () => { await call('check_coverage', {}); return `Still one gap. ${explain()}`; } }
];

// ---------- rendering ----------
function bubble(who, text) {
  const li = document.createElement('li');
  li.className = `turn ${who}`;
  li.innerHTML = `<span class="who">${who === 'you' ? 'You' : 'Alexa+'}</span><p>${esc(text)}</p>`;
  $('#chat').append(li); li.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return li;
}
function wire(name, args) {
  const li = document.createElement('li');
  li.className = 'call pending';
  li.innerHTML = `<div class="call-head"><code class="tool">${esc(name)}</code><span class="meta">calling…</span></div>
    <details><summary>arguments</summary><pre>${esc(JSON.stringify(args, null, 2))}</pre></details>`;
  $('#wire').prepend(li);
  $('#wire-empty')?.remove();
  return li;
}
function finishWire(li, r, value, ms) {
  li.classList.remove('pending');
  li.classList.add(r.isError ? 'error' : 'ok');
  const s = value?.current ?? value;
  const summary = r.isError ? r.content?.[0]?.text : `${s.status} · rev ${s.revision}${s.nextAction ? ` · next: ${s.nextAction.code}` : ''}`;
  li.querySelector('.meta').textContent = `${ms} ms`;
  li.insertAdjacentHTML('beforeend', `<p class="summary">${r.isError ? '⚠ isError: ' : '← '}${esc(summary)}</p>
    <details><summary>result</summary><pre>${esc(JSON.stringify(r.isError ? r.content : value, null, 2))}</pre></details>`);
}
function render() {
  const board = $('#board');
  if (!state?.tasks) { board.innerHTML = '<p class="muted">No handover yet. Start the conversation.</p>'; $('#status').className = 'status idle'; $('#status').textContent = 'No plan'; return; }
  const covered = state.status === 'ENTERED_TASKS_COVERED';
  $('#status').className = `status ${covered ? 'good' : 'warn'}`;
  $('#status').textContent = covered ? 'Entered tasks covered' : 'Needs attention';
  const from = 480, to = 600, pct = m => ((m - from) / (to - from)) * 100;
  board.innerHTML = `<div class="row axis-row"><span></span><div class="axis">${[480, 510, 540, 570, 600].map(m => `<span class="${m % 60 ? 'half' : ''}" style="left:${pct(m)}%">${hhmm(m)}</span>`).join('')}</div><span></span></div>` +
    state.tasks.map(t => {
      const tag = t.covered ? ['good', 'Accepted'] : t.blockers[0].code === 'OVERLAP' ? ['bad', 'Clash'] : t.blockers[0].code === 'UNASSIGNED' ? ['bad', 'Nobody'] : ['warn', 'Not yet accepted'];
      return `<div class="row"><div class="label"><b>${esc(t.label)}</b><span>${t.assignee ? esc(person(t.assignee)) : 'Unassigned'} · ${hhmm(t.start)}–${hhmm(t.end)}</span></div>
        <div class="track"><div class="bar ${tag[0]}" style="left:${pct(t.start)}%;width:${pct(t.end) - pct(t.start)}%"></div></div>
        <span class="chip ${tag[0]}">${tag[1]}</span></div>`;
    }).join('') + `<p class="next">${state.nextAction ? `<b>Tool’s next action:</b> ${esc(state.nextAction.text)}` : `<b>${esc(state.statement)}</b>`}</p>`;
}
function ring(mode) { $('#echo').dataset.mode = mode; }
function speak(text) {
  return new Promise(res => {
    if (!voice || !('speechSynthesis' in window)) return setTimeout(res, 350);
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.04; u.onend = u.onerror = res;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}
function updateControls() {
  const done = step >= turns.length;
  $('#next').disabled = busy || done;
  $('#auto').disabled = busy || done;
  $('#next').textContent = done ? 'Demo complete' : step === 0 ? 'Start the conversation' : 'Next turn';
  $('#progress').style.width = `${(step / turns.length) * 100}%`;
  $('#hint').textContent = done ? 'That was every turn. Reset to replay.' : `Next you’ll say: “${turns[step].you}”`;
}
async function next() {
  if (busy || step >= turns.length) return;
  busy = true; updateControls();
  try {
    if (!client) { ring('thinking'); await connect(); }
    const t = turns[step];
    ring('listening'); bubble('you', t.you);
    await new Promise(r => setTimeout(r, 650));
    ring('thinking');
    const reply = await t.run();
    ring('speaking'); bubble('alexa', reply);
    await speak(reply);
    step++;
  } catch (e) {
    bubble('alexa', `Sorry, I couldn’t reach Open Tomorrow (${e.message}). Try reset.`);
    auto = false;
  } finally { ring('idle'); busy = false; updateControls(); }
  if (auto && step < turns.length) setTimeout(next, voice ? 400 : 1200);
  else auto = false;
}
async function reset() {
  if (busy) return;
  auto = false; speechSynthesis?.cancel?.();
  await fetch(`/reset?session=${session}`, { method: 'POST' }).catch(() => {});
  session = newSession(); sessionStorage.setItem('ot-session', session);
  try { await client?.close(); } catch {}
  client = null; state = null; step = 0; op = 0;
  $('#chat').innerHTML = ''; $('#wire').innerHTML = '<li id="wire-empty" class="muted">Tool calls appear here as Alexa+ makes them.</li>';
  $('#proto').textContent = 'Not connected yet';
  render(); updateControls();
}
$('#next').onclick = next;
$('#auto').onclick = () => { auto = true; next(); };
$('#reset').onclick = reset;
$('#voice').onclick = () => { voice = !voice; $('#voice').setAttribute('aria-pressed', voice); $('#voice').textContent = voice ? '🔊 Voice on' : '🔈 Voice off'; if (!voice) speechSynthesis?.cancel?.(); };
if (!('speechSynthesis' in window)) $('#voice').hidden = true;
// Start each page load from a clean server-side plan.
reset();

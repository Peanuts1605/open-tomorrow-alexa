// Browser side: a real MCP client (official SDK) driving a scripted Alexa+-style conversation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { florist as fixture } from '../fixture.mjs';
import qrcode from 'qrcode-generator';

// The fictional plan is always for the next real Saturday, computed on the visitor's device.
const nextSaturday = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d; })();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const florist = { ...fixture, date: iso(nextSaturday) };

const $ = s => document.querySelector(s);
const hhmm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const say = n => { const h = Math.floor(n / 60), m = n % 60; return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newSession = () => crypto.randomUUID();
let session = sessionStorage.getItem('ot-session') || newSession();
sessionStorage.setItem('ot-session', session);

let client, protocol = '', state = null, op = 0, step = 0, busy = false, auto = false;
let freeUsed = false, voice = false, speed = 1, cancelled = new Set(), lastPerson = null, qrKey = '';
const mobile = () => matchMedia('(max-width: 900px)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms / speed));
document.getElementById('day').textContent = nextSaturday.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

async function connect() {
  client = new Client({ name: 'alexa-plus-simulator', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`/mcp?session=${session}`, location.origin), {
    fetch: async (url, options) => {
      // This server is JSON-response only (no server-initiated SSE stream). Answer the SDK's optional GET probe
      // locally with the same 405 the server would send, so the browser never logs a failed request.
      if ((options?.method ?? 'GET').toUpperCase() === 'GET') return new Response(null, { status: 405, headers: { allow: 'POST' } });
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
async function change(c) {
  const send = () => call('change_handover', { expectedRevision: state.revision, operationId: `alexa-${session.slice(0, 8)}-${++op}`, change: c });
  let r = await send();
  // Someone (e.g. a helper on their phone) may have changed the plan: re-read once, then retry against the fresh revision.
  if (r.error?.startsWith('STALE_REVISION')) { await call('check_coverage', {}); r = await send(); }
  if (!r.error && c.kind === 'cancel') cancelled.add(c.person);
  return r;
}
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
  { you: 'Alexa, where do we stand?', run: async () => { await call('check_coverage', {}); return `Still one gap. ${explain()}`; } },
  { you: 'Give it to Helper C.', run: async () => { await change({ kind: 'assign', task: 'delivery', person: 'spare' }); return `Done. The delivery is with Helper C now, but that’s an assignment, not a yes. I’ve put a helper card up. Helper C can accept it from their phone.`; } },
  { you: 'Helper C just tapped accept.', run: async () => {
      const t = task('delivery');
      if (!t.covered) await change({ kind: 'record_acceptance', task: 'delivery', person: 'spare', taskVersion: t.version, simulated: true });
      return state.status === 'ENTERED_TASKS_COVERED' ? 'That one counts: a fresh yes for the current assignment. You’re covered ✅ for every task you gave me. Enjoy your Saturday off.' : explain(); } }
];

// ---------- free-text turns: a deterministic intent router over the same MCP tools (no language model) ----------
const PEOPLE = florist.people;
function findPerson(text) {
  const m = text.match(/\bhelper\s*([a-z])\b/i) ?? text.match(/\b([abc])\b(?=\s+(?:can|is|will|said|says|accept|took|takes|cancel|won|isn|doesn|has|just))/i);
  const p = m && PEOPLE.find(x => x.label.toLowerCase() === `helper ${m[1].toLowerCase()}`);
  if (p) return (lastPerson = p);
  if (/\b(they|them|she|he|her|him)\b/i.test(text)) return lastPerson;
  return null;
}
function findTask(text) {
  if (/deliver|flower|drop.?off|van|run/i.test(text)) return 'delivery';
  if (/set ?up|open(ing)?\b|shop|till|morning prep/i.test(text)) return 'setup';
  return null;
}
const pending = () => state.tasks.filter(t => t.assignee && t.blockers.length === 1 && t.blockers[0].code === 'AWAITING_ACCEPTANCE');
function freeFor(t) {
  return PEOPLE.filter(p => !cancelled.has(p.id) && p.available.some(w => w.start <= t.start && w.end >= t.end)
    && !state.tasks.some(o => o.id !== t.id && o.assignee === p.id && t.start < o.end && o.start < t.end));
}
async function route(raw) {
  const text = raw.replace(/[’‘]/g, "'").trim();
  if (!state?.tasks) {
    const r = await call('create_handover', { plan: florist });
    if (r.error?.startsWith('PLAN_EXISTS')) await call('check_coverage', {});
    if (/\b(off|covered|saturday|start|hello|hi|hey|alexa)\b/i.test(text) && !findPerson(text)) return `I’ve loaded Saturday’s handover. ${explain()}`;
  }
  const who = findPerson(text);
  const which = findTask(text);
  // 1. Someone can't come.
  if (/\b(can'?t|cannot|can not|won'?t|isn'?t|not)\s+(come|make it|do it|work|coming|able|available)|cancel|called (in )?sick|is (out|sick|off)|dropped out|bail/i.test(text)) {
    if (!who) return 'Who can’t come? Say “Helper A”, “Helper B” or “Helper C”.';
    await change({ kind: 'cancel', person: who.id });
    return `Okay, I’ve taken ${who.label} off. ${explain()}`;
  }
  // 2. A helper said yes (simulated acceptance of the CURRENT assignment only).
  if (/\b(said|says|say) (yes|ok|okay)|accept|agreed|is in\b|confirmed it|on board/i.test(text) && !/that'?s (everything|all)/i.test(text)) {
    const mine = pending().filter(t => !who || t.assignee === who.id).filter(t => !which || t.id === which);
    if (!mine.length) {
      if (who) {
        const t = which ? task(which) : state.tasks.find(x => !x.covered) ?? state.tasks[0];
        const r = await change({ kind: 'record_acceptance', task: t.id, person: who.id, taskVersion: t.version, simulated: true });
        if (r.error) return `I can’t count that. ${who.label} isn’t the current assignee for “${t.label.toLowerCase()}”, so their yes doesn’t apply. ${explain()}`;
        return explain();
      }
      await call('check_coverage', {});
      return `Nobody is waiting to accept anything right now. ${explain()}`;
    }
    for (const t of mine) await change({ kind: 'record_acceptance', task: t.id, person: t.assignee, taskVersion: task(t.id).version, simulated: true });
    return explain();
  }
  // 3. Give a task to someone.
  if (who && /\b(give|assign|hand|move|put|switch|send)\b|\bcan (take|do|cover|handle|have)\b|\bwill (take|do|cover|handle)\b|\b(take|takes|cover|covers)\b/i.test(text)) {
    const t = which ? task(which) : task(state.nextAction?.task ?? '') ?? state.tasks.find(x => !x.covered);
    if (!t) { await call('check_coverage', {}); return `Everything you entered is already covered. ${explain()}`; }
    await change({ kind: 'assign', task: t.id, person: who.id });
    const now = task(t.id);
    if (now.blockers.some(b => b.code === 'UNAVAILABLE')) return `I’ve put “${t.label.toLowerCase()}” with ${who.label}, but they aren’t free for all of it, so it isn’t covered. Try someone else.`;
    if (now.blockers.some(b => b.code === 'OVERLAP')) return `That makes a clash: ${who.label} would be double-booked. ${explain()}`;
    return `Done. “${t.label}” is with ${who.label}, but assigned isn’t agreed. ${who.label} still needs to say yes. You can scan the helper card to accept as them.`;
  }
  // 4. That's the whole list.
  if (/that'?s (everything|all|it)|nothing else|full list|confirm/i.test(text)) {
    await change({ kind: 'confirm_entered_scope', confirmed: true });
    return explain();
  }
  // 5. Who's free?
  if (/who'?s? (is )?(free|available|around)|anyone (free|available|else)|who (else )?can/i.test(text)) {
    await call('check_coverage', {});
    let t = task(state.nextAction?.task ?? '') ?? state.tasks.find(x => !x.covered);
    if (!t) return `Nobody needs to step in. ${explain()}`;
    // For a clash, ask about the task that starts later: that's the one that usually needs a second helper.
    const clash = t.blockers.find(b => b.code === 'OVERLAP');
    if (clash && task(clash.with).start > t.start) t = task(clash.with);
    const free = freeFor(t).filter(p => p.id !== t.assignee);
    return free.length ? `For “${t.label.toLowerCase()}” (${say(t.start)}–${say(t.end)}), ${free.map(p => p.label).join(' and ')} ${free.length > 1 ? 'are' : 'is'} free with no clash. Who should take it?`
      : `Nobody else is free for “${t.label.toLowerCase()}” without a clash.`;
  }
  // 6. Where do we stand?
  if (/uncovered|stand|covered|status|gap|left|missing|are we (good|ok|okay|set)|check|how('?s| is| are)/i.test(text)) {
    await call('check_coverage', {});
    return state.uncoveredTasks.length ? `${state.uncoveredTasks.length === 1 ? 'One task is' : `${state.uncoveredTasks.length} tasks are`} not covered yet. ${explain()}` : explain();
  }
  return 'I can check who’s free, take someone off, give a task to a helper, record a helper’s yes, confirm the list, or tell you what’s uncovered. Try “Helper C can take the delivery.”';
}
async function freeText(text) {
  if (busy || !text.trim()) return;
  busy = true; auto = false; freeUsed = true; updateControls();
  try {
    if (!client) { ring('thinking'); await connect(); }
    ring('listening'); bubble('you', text.trim(), true);
    await wait(350);
    ring('thinking');
    const reply = await route(text);
    ring('speaking'); bubble('alexa', reply);
    await speak(reply);
  } catch (e) { bubble('alexa', `Sorry, I couldn’t reach Open Tomorrow (${e.message}). Try reset.`); }
  finally { ring('idle'); busy = false; updateControls(); }
}

// ---------- QR helper card: a phone accepts the current assignment; this screen polls a tiny read endpoint ----------
function renderQr() {
  const card = $('#qrcard');
  const t = state?.tasks && pending().find(x => !cancelled.has(x.assignee));
  if (!t) { card.hidden = true; qrKey = ''; return; }
  const key = `${t.id}:${t.assignee}:${t.version}`;
  card.hidden = false;
  if (key === qrKey) return;
  qrKey = key;
  const url = new URL(`/helper?session=${encodeURIComponent(session)}&task=${encodeURIComponent(t.id)}&person=${encodeURIComponent(t.assignee)}`, location.origin).href;
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  $('#qrlink').href = url;
  $('#qrask').textContent = `${person(t.assignee)}: accept the ${say(t.start)} ${/^deliver/i.test(t.label) ? 'delivery' : 'shift'}?`;
}
setInterval(async () => {
  if (busy || auto || !client || $('#qrcard').hidden || document.hidden) return;
  try {
    const d = await (await fetch(`/api/summary?session=${session}`, { cache: 'no-store' })).json();
    if (!(d.revision > state.revision) || busy) return;
    busy = true; updateControls();
    const before = pending().map(t => t.assignee);
    await call('check_coverage', {});
    const who = before.filter(id => !pending().some(t => t.assignee === id)).map(person);
    const reply = `${who.length ? `${who.join(' and ')} just accepted on their phone. ` : ''}${state.status === 'ENTERED_TASKS_COVERED' ? 'That’s a fresh yes for the current assignment. You’re covered ✅ for every task you gave me.' : explain()}`;
    ring('speaking'); bubble('alexa', reply); await speak(reply);
    if (state.status === 'ENTERED_TASKS_COVERED' && mobile()) $('#board').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {} finally { if (busy) { ring('idle'); busy = false; updateControls(); } }
}, 2000);

// ---------- rendering ----------
function bubble(who, text, typed = false) {
  const li = document.createElement('li');
  li.className = `turn ${who}${typed ? ' typed' : ''}`;
  li.innerHTML = `<span class="who">${who === 'you' ? 'You' : 'Alexa+'}</span><p>${esc(text)}</p>`;
  const chat = $('#chat'); chat.append(li);
  // Scroll only inside the conversation, never the page, so mobile readers aren't yanked around.
  chat.scrollTo({ top: chat.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
  renderQr();
  const board = $('#board');
  if (!state?.tasks) { board.innerHTML = '<p class="muted">No handover yet. Start the conversation.</p>'; $('#status').className = 'status idle'; $('#status').textContent = 'No plan'; return; }
  const covered = state.status === 'ENTERED_TASKS_COVERED';
  $('#status').className = `status ${covered ? 'good' : 'warn'}`;
  $('#status').textContent = covered ? 'Entered tasks covered' : 'Needs attention';
  const from = 480, to = 600, pct = m => ((m - from) / (to - from)) * 100;
  board.innerHTML = `<div class="row axis-row"><span></span><div class="axis">${[480, 510, 540, 570, 600].map(m => `<span class="${m % 60 ? 'half' : ''}" style="left:${pct(m)}%">${hhmm(m)}</span>`).join('')}</div><span></span></div>` +
    state.tasks.map(t => {
      const tag = t.covered ? ['good', 'Accepted'] : t.blockers[0].code === 'OVERLAP' ? ['bad', 'Clash'] : t.blockers[0].code === 'UNASSIGNED' ? ['bad', 'Nobody'] : ['warn', 'Not yet accepted'];
      return `<div class="row"><div class="label"><b>${esc(t.label)}</b><span>${t.assignee ? esc(person(t.assignee)) : 'Unassigned'} · <span class="nw">${hhmm(t.start)}–${hhmm(t.end)}</span></span></div>
        <div class="track"><div class="bar ${tag[0]}" style="left:${pct(t.start)}%;width:${pct(t.end) - pct(t.start)}%"></div></div>
        <span class="chip ${tag[0]}">${tag[1]}</span></div>`;
    }).join('') + `<p class="next">${state.nextAction ? `<b>Tool’s next action:</b> ${esc(state.nextAction.text)}` : `<b>${esc(state.statement)}</b>`}</p>`;
}
function ring(mode) { $('#echo').dataset.mode = mode; }
function speak(text) {
  return new Promise(res => {
    if (!voice || !('speechSynthesis' in window)) return setTimeout(res, 350 / speed);
    const u = new SpeechSynthesisUtterance(text.replace('✅', '')); u.rate = Math.min(2, 1.04 * speed); u.onend = u.onerror = res;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}
function updateControls() {
  const done = step >= turns.length || freeUsed;
  $('#next').disabled = busy || done;
  $('#auto').disabled = busy || done;
  $('#send').disabled = busy; $('#mic').disabled = busy; document.querySelectorAll('.ex').forEach(b => b.disabled = busy);
  $('#next').textContent = freeUsed ? 'Scripted story paused' : done ? 'Demo complete' : step === 0 ? 'Start the conversation' : 'Next turn';
  $('#progress').style.width = `${(step / turns.length) * 100}%`;
  $('#hint').textContent = freeUsed ? 'You’re talking freely now. Reset to replay the scripted story.' : done ? 'That was every turn. Reset to replay.' : `Next you’ll say: “${turns[step].you}”`;
}
async function next() {
  if (busy || step >= turns.length) return;
  busy = true; updateControls();
  try {
    if (!client) { ring('thinking'); await connect(); }
    const t = turns[step];
    ring('listening'); bubble('you', t.you);
    await wait(650);
    ring('thinking');
    const reply = await t.run();
    ring('speaking'); bubble('alexa', reply);
    await speak(reply);
    step++;
  } catch (e) {
    bubble('alexa', `Sorry, I couldn’t reach Open Tomorrow (${e.message}). Try reset.`);
    auto = false;
  } finally { ring('idle'); busy = false; updateControls(); }
  if (auto && step < turns.length) setTimeout(next, (voice ? 400 : 1200) / speed);
  else {
    if (auto && step >= turns.length && mobile()) $('#board').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    auto = false;
  }
}
async function reset() {
  if (busy) return;
  auto = false; speechSynthesis?.cancel?.();
  await fetch(`/reset?session=${session}`, { method: 'POST' }).catch(() => {});
  session = newSession(); sessionStorage.setItem('ot-session', session);
  try { await client?.close(); } catch {}
  client = null; state = null; step = 0; op = 0; freeUsed = false; cancelled = new Set(); lastPerson = null;
  $('#chat').innerHTML = ''; $('#wire').innerHTML = '<li id="wire-empty" class="muted">Tool calls appear here as Alexa+ makes them.</li>';
  $('#proto').textContent = 'Not connected yet';
  render(); updateControls();
}
$('#next').onclick = next;
$('#auto').onclick = () => { auto = true; next(); };
$('#reset').onclick = reset;
$('#voice').onclick = () => { voice = !voice; $('#voice').setAttribute('aria-pressed', voice); $('#voice').textContent = voice ? '🔊 Voice' : '🔈 Voice'; if (!voice) speechSynthesis?.cancel?.(); };
if (!('speechSynthesis' in window)) $('#voice').hidden = true;
$('#speed').onclick = () => { speed = speed === 1 ? 2 : 1; $('#speed').textContent = `${speed}×`; $('#speed').setAttribute('aria-pressed', speed === 2); };
$('#ask').onsubmit = e => { e.preventDefault(); const v = $('#say').value; $('#say').value = ''; freeText(v); };
document.querySelectorAll('.ex').forEach(b => b.onclick = () => freeText(b.textContent));
$('#towire').onclick = e => { e.preventDefault(); $('#wirecard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Rec) {
  $('#mic').hidden = false;
  $('#mic').onclick = () => {
    const rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    $('#mic').dataset.on = '1'; ring('listening');
    rec.onresult = e => { const t = e.results[0][0].transcript; freeText(t); };
    rec.onend = rec.onerror = () => { $('#mic').dataset.on = ''; if (!busy) ring('idle'); };
    rec.start();
  };
}
// Start each page load from a clean server-side plan.
reset();

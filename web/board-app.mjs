// MCP Apps view (SEP-1865, @modelcontextprotocol/ext-apps): the handover board as an interactive card.
// Any MCP Apps host (or this repo's own simulated Alexa+ page) renders it in a sandboxed iframe when
// create_handover, check_coverage or change_handover returns. It only reads the tool result it is given and can
// ask the host to call check_coverage again; it never writes to the plan and has no network access of its own.
import { App } from '@modelcontextprotocol/ext-apps';

const root = document.getElementById('board');
const refresh = document.getElementById('refresh');
const stamp = document.getElementById('stamp');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = n => { const h = Math.floor(n / 60), m = n % 60; return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`; };

export function stateOf(task) {
  if (task.covered) return ['ok', 'Covered'];
  const codes = task.blockers.map(b => b.code);
  if (codes.includes('UNASSIGNED')) return ['bad', 'Nobody'];
  if (codes.includes('OVERLAP')) return ['bad', 'Clash'];
  if (codes.includes('UNAVAILABLE')) return ['bad', 'Not free'];
  if (codes.includes('AWAITING_ACCEPTANCE')) return ['warn', 'Waiting for yes'];
  return ['warn', 'Needs attention'];
}

export function render(plan) {
  if (!plan?.tasks) { root.innerHTML = '<p class="muted">No handover yet. Ask Open Tomorrow to start one.</p>'; return; }
  const who = id => plan.people?.find(p => p.id === id)?.label ?? id ?? 'Nobody';
  const covered = plan.status === 'ENTERED_TASKS_COVERED';
  root.innerHTML = `
    <header><div><small>Open Tomorrow · handover</small><h1>${esc(plan.title)}</h1></div>
      <span class="pill ${covered ? 'ok' : 'warn'}">${covered ? 'Entered tasks covered' : 'Needs attention'}</span></header>
    <ul>${plan.tasks.map(t => { const [tone, label] = stateOf(t); return `
      <li><div class="t"><b>${esc(t.label)}</b><span>${clock(t.start)}–${clock(t.end)} · ${esc(who(t.assignee))}</span></div>
        <span class="pill ${tone}">${label}</span></li>`; }).join('')}</ul>
    <p class="next">${covered ? 'Every task you entered has a fresh, simulated yes, and you confirmed the list.' : esc(plan.nextAction?.text ?? '')}</p>
    <p class="muted">Revision ${plan.revision} · scope ${plan.scopeConfirmed ? 'confirmed' : 'not confirmed'} · fictional shop, simulated helpers</p>`;
  stamp.textContent = `rev ${plan.revision}`;
}

const app = new App({ name: 'open-tomorrow-board', version: '0.3.0' }, {});
const take = result => { const v = result?.structuredContent; if (v) render(v.current ?? v); };
app.ontoolresult = take;
// Follow the host's light/dark theme when it sends one; otherwise the OS setting applies.
const theme = ctx => { if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme; };
app.onhostcontextchanged = theme;
refresh.onclick = async () => {
  refresh.disabled = true;
  try { take(await app.callServerTool({ name: 'check_coverage', arguments: {} })); }
  catch { stamp.textContent = 'refresh failed'; }
  finally { refresh.disabled = false; }
};
render(null);
app.connect().then(() => theme(app.getHostContext())).catch(() => { stamp.textContent = 'no host'; });

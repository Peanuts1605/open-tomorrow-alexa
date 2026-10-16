// Phone-side helper card opened from the QR code. Fictional and simulated: tapping Accept records a
// simulated acceptance for the exact current assignment; no real person is contacted.
export const HELPER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Helper card · Open Tomorrow for Alexa+</title><meta name="robots" content="noindex"><link rel="icon" href="data:,">
<style>
:root{--bg:#0a1020;--line:#24324f;--ink:#eef3ff;--muted:#93a0bd;--cyan:#22d3ee;--good:#34d399;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:radial-gradient(700px 400px at 20% -10%,#18305e 0,transparent 60%),var(--bg)}
.card{width:100%;max-width:400px;background:linear-gradient(180deg,#131d36,#0f1830);border:1px solid var(--line);border-radius:22px;padding:26px 22px;box-shadow:0 20px 50px #0007;text-align:center}
small{color:var(--cyan);letter-spacing:.16em;text-transform:uppercase;font-size:11px;font-weight:700}
h1{font-size:24px;line-height:1.25;margin:12px 0 6px;letter-spacing:-.01em}p{color:var(--muted);margin:0 0 18px}
button{font:inherit;font-weight:700;width:100%;min-height:52px;border-radius:14px;border:0;background:linear-gradient(135deg,#0ea5c6,#2563eb);color:#fff;cursor:pointer}
button:disabled{opacity:.5}.done{font-size:56px;line-height:1;margin:6px 0}.ok{color:var(--good)}.err{color:var(--bad)}
.fine{font-size:12px;margin:16px 0 0}
</style></head><body><main class="card" aria-live="polite"><small>Open Tomorrow · helper card</small><div id="c"><h1>Loading…</h1></div>
<p class="fine">Fictional demo. Your tap records a simulated acceptance only. No real schedule changes and no messages are sent.</p></main>
<script>
const q=new URLSearchParams(location.search),s=q.get('session')||'',task=q.get('task'),person=q.get('person'),c=document.getElementById('c');
const say=n=>{const h=Math.floor(n/60),m=n%60;return (h>12?h-12:h)+':'+String(m).padStart(2,'0')};
const esc=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function load(){
  try{const r=await fetch('/api/summary?session='+encodeURIComponent(s),{cache:'no-store'});const d=await r.json();
    const t=(d.pending||[]).find(x=>x.task===task&&x.person===person);
    if(!t){c.innerHTML='<div class="done ok">✓</div><h1>Nothing waiting for you</h1><p>This request was already answered or has changed. Ask the shop owner for a fresh code.</p>';return}
    c.innerHTML='<h1>'+esc(t.personLabel)+': accept the '+say(t.start)+' '+(/^deliver/i.test(t.label)?'delivery':'shift')+'?</h1><p>“'+esc(t.label)+'” · '+say(t.start)+'–'+say(t.end)+' on Saturday<br>Fictional flower shop</p><button id="a">Accept</button>';
    document.getElementById('a').onclick=accept;
  }catch(e){c.innerHTML='<h1 class="err">Couldn’t reach Open Tomorrow</h1><p>Check your connection and rescan.</p>'}
}
async function accept(){const b=document.getElementById('a');b.disabled=true;b.textContent='Accepting…';
  const r=await fetch('/api/accept?session='+encodeURIComponent(s),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task,person})}).catch(()=>null);
  if(r&&r.ok){c.innerHTML='<div class="done ok">✅</div><h1>Accepted</h1><p>Thanks. The shop owner’s screen updates on its own.</p>'}
  else{const d=r?await r.json().catch(()=>({})):{};c.innerHTML='<h1 class="err">Not recorded</h1><p>'+esc(d.error||'Network error')+'. The assignment may have changed; ask for a fresh code.</p>'}}
load();
</script></body></html>`;

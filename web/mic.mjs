// Microphone → speech-to-text for the simulated Alexa+ page.
// Rules: getUserMedia is the FIRST call inside the click (so Chrome/Safari show the permission prompt from a real
// user gesture), every failure ends in a visible, plain-language status, and a live level bar proves audio is arriving.

export function gumMessage(e) {
  const name = e?.name ?? '', msg = String(e?.message ?? '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/i.test(msg)) return 'Your computer is blocking the browser from the microphone. On a Mac: System Settings → Privacy & Security → Microphone → turn on Google Chrome, then quit and reopen Chrome.';
    return 'Microphone is blocked for this page. Click the icon at the left of the address bar → Microphone → Allow, then tap 🎤 again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in or pick an input in your sound settings, then tap 🎤 again.';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'The microphone is busy or failed to start (another app may be using it). Close that app and tap 🎤 again.';
  if (name === 'SecurityError') return 'The microphone only works on a secure (https) page.';
  return `The microphone could not start (${name || 'unknown error'}). You can type instead.`;
}

export function speechMessage(code) {
  return {
    'no-speech': 'I didn’t hear anything. Tap 🎤 and start talking right away.',
    'audio-capture': 'The browser could not record from the microphone. Check your input device in sound settings, then tap 🎤 again.',
    'not-allowed': 'Speech recognition is blocked for this page. Click the icon left of the address bar → Microphone → Allow, then tap 🎤 again.',
    'service-not-allowed': 'This browser’s speech service is turned off. Use Chrome, or type instead.',
    network: 'The browser’s speech service could not be reached. Check your internet connection and tap 🎤 again.',
    'language-not-supported': 'English speech recognition isn’t available in this browser. Type instead.',
    aborted: 'Stopped listening.'
  }[code] ?? (code ? `Speech recognition stopped (${code}). Tap 🎤 to try again.` : null);
}

// Speech-to-text tuning for this page's tiny vocabulary. A general-purpose recognizer hears "Helper C" as
// "help her see", "Helper B" as "helper be", and so on, and with only one alternative the router gets the wrong words.
const LETTER = { a: 'A', ay: 'A', eh: 'A', hey: 'A', b: 'B', be: 'B', bee: 'B', c: 'C', see: 'C', sea: 'C', si: 'C', cee: 'C' };
export function normalizeTranscript(raw) {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // "help her see", "helper sea", "hyper c", "help a b" → "Helper C" / "Helper B"
  t = t.replace(/\b(?:help(?:er|a|ers)?|help her|hyper|halper|elper)\s*[-.]?\s*(a|ay|eh|hey|b|be|bee|c|see|sea|si|cee)\b\.?/gi, (_, l) => `Helper ${LETTER[l.toLowerCase()]}`);
  t = t.replace(/\bdelivered\b(?=\s*(?:to|with|for|$))/gi, 'delivery').replace(/\bset-?up\b/gi, 'setup');
  return t;
}
const VOCAB = /\bhelper [abc]\b|\bdeliver|\bsetup\b|\bset up\b|\bfree\b|\bavailable\b|\baccept|\bcancel|\bcan'?t come\b|\bcovered\b|\bthat'?s (?:everything|all|it)\b/gi;
export function scoreTranscript(text) { return (String(text).match(VOCAB) ?? []).length; }
// results: a SpeechRecognitionResultList-like array. Joins every segment and, per segment, picks the alternative that
// mentions the most of this page's words (ties keep the recognizer's own first choice).
export function readResults(results, from = 0) {
  let text = '', isFinal = true;
  for (let i = from; i < results.length; i++) {
    const r = results[i], alts = [];
    for (let j = 0; j < r.length; j++) if (r[j]?.transcript != null) alts.push(normalizeTranscript(r[j].transcript));
    let best = alts[0] ?? '', bestScore = scoreTranscript(best);
    for (const a of alts.slice(1)) { const sc = scoreTranscript(a); if (sc > bestScore) { best = a; bestScore = sc; } }
    text += (text && best ? ' ' : '') + best;
    if (!r.isFinal) isFinal = false;
  }
  return { text: text.trim(), isFinal };
}

// env: { window, navigator, Rec, ui: { status(text, kind), listening(on|'wait'|false), level(0..1) }, onText(text), timeoutMs }
export function createMic(env) {
  const { navigator: nav, ui, onText } = env;
  const Rec = env.Rec === undefined ? (env.window.SpeechRecognition || env.window.webkitSpeechRecognition) : env.Rec;
  const AC = env.window.AudioContext || env.window.webkitAudioContext;
  const timeoutMs = env.timeoutMs ?? 10000;
  const s = { stream: null, rec: null, ctx: null, raf: 0, timer: 0, heard: false, error: null, peak: 0, active: false, generation: 0 };

  function release() {
    s.generation++;
    clearTimeout(s.timer); s.timer = 0;
    if (s.raf) (env.window.cancelAnimationFrame || clearTimeout)(s.raf); s.raf = 0;
    s.stream?.getTracks().forEach(t => t.stop()); s.stream = null;
    try { s.ctx?.close(); } catch {} s.ctx = null;
    s.active = false; ui.listening(false); ui.level(0);
  }
  function meter(stream) {
    if (!AC) return;
    try {
      const ctx = s.ctx = new AC(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const raf = env.window.requestAnimationFrame?.bind(env.window) ?? (f => setTimeout(f, 50));
      const tick = () => { an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4); s.peak = Math.max(s.peak, lvl); ui.level(lvl); s.raf = raf(tick); };
      ctx.resume?.(); tick();
    } catch { /* meter is a nicety; recognition still works */ }
  }
  function finish() {
    const heard = s.heard, err = s.error, peak = s.peak; release(); s.rec = null;
    if (heard) return;
    if (err) return ui.status(speechMessage(err), err === 'aborted' ? 'info' : 'error');
    ui.status(peak < 0.01 && AC ? 'Your microphone is on but completely silent. Check the input device in your sound settings, then tap 🎤 again.' : speechMessage('no-speech'), 'error');
  }

  // Must be called directly from the click handler. Returns a promise for tests; the first thing it does is request the mic.
  function toggle() {
    if (s.active) { s.error = 'aborted'; if (s.rec) { try { s.rec.stop(); } catch { finish(); } } else finish(); return Promise.resolve('stopped'); }
    if (env.window.isSecureContext === false) { ui.status(gumMessage({ name: 'SecurityError' }), 'error'); return Promise.resolve('insecure'); }
    if (!nav?.mediaDevices?.getUserMedia) { ui.status(Rec ? 'This browser can’t open the microphone here. Type instead.' : 'Voice input isn’t supported in this browser. Use Chrome or Safari, or type instead.', 'error'); return Promise.resolve('unsupported'); }
    s.active = true; s.heard = false; s.error = null; s.peak = 0;
    const generation = ++s.generation;
    const pending = nav.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); // synchronous, inside the gesture
    ui.listening('wait'); ui.status('Asking for the microphone… click “Allow” if your browser asks.', 'wait');
    return pending.then(stream => {
      if (!s.active || generation !== s.generation) { stream.getTracks().forEach(t => t.stop()); return 'stopped'; }
      s.stream = stream; meter(stream);
      if (!Rec) {
        ui.listening(true); ui.status('Your microphone works, but this browser can’t turn speech into text. Use Chrome or Safari, or type below.', 'error');
        s.timer = setTimeout(release, 2500); return 'no-recognition';
      }
      const rec = s.rec = new Rec(); rec.lang = env.lang ?? 'en-US'; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
      rec.onresult = e => {
        const { text, isFinal } = readResults(e.results);
        if (!isFinal) { ui.status(`🎙️ “${text}…”`, 'live'); return; }
        if (!text) return;
        s.heard = true; ui.status(`Heard: “${text}”`, 'ok'); onText(text);
      };
      rec.onerror = e => { if (!s.error) s.error = e.error; };
      rec.onend = finish;
      try { rec.start(); } catch (e) { s.error = 'start-failed'; finish(); ui.status('Microphone is allowed now. Tap 🎤 once more to talk.', 'info'); return 'start-failed'; }
      ui.listening(true); ui.status('🎙️ Listening… speak now (tap 🎤 again to stop).', 'live');
      s.timer = setTimeout(() => { try { rec.stop(); } catch { finish(); } }, timeoutMs);
      return 'listening';
    }, e => { if (generation !== s.generation) return 'stopped'; release(); ui.status(gumMessage(e), 'error'); return 'denied'; });
  }
  return { toggle, state: s, supported: !!(nav?.mediaDevices?.getUserMedia) };
}

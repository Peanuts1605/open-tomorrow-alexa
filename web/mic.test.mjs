import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMic, gumMessage, speechMessage } from './mic.mjs';

const tick = () => new Promise(r => setTimeout(r, 0));
function harness({ gum = 'ok', Rec, secure = true, noMedia = false } = {}) {
  const log = [], ui = { statuses: [], listening: [] };
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const navigator = noMedia ? {} : { mediaDevices: { getUserMedia: c => { log.push(['gum', c]); return gum === 'ok' ? Promise.resolve(stream) : Promise.reject(gum); } } };
  const recs = [];
  class FakeRec { constructor() { recs.push(this); } start() { log.push(['start']); } stop() { log.push(['stop']); this.onend?.(); } }
  const mic = createMic({
    window: { isSecureContext: secure }, navigator, Rec: Rec === undefined ? FakeRec : Rec, timeoutMs: 50,
    ui: { status: (t, k) => ui.statuses.push([k, t]), listening: v => ui.listening.push(v), level: () => {} },
    onText: t => log.push(['text', t])
  });
  return { mic, log, ui, recs, track, last: () => ui.statuses.at(-1) };
}

test('mic: getUserMedia is requested synchronously inside the click, before any await', () => {
  const h = harness(); h.mic.toggle();
  assert.deepEqual(h.log[0][0], 'gum'); assert.equal(h.log[0][1].audio.echoCancellation, true);
  assert.equal(h.ui.listening[0], 'wait'); assert.match(h.last()[1], /Allow/);
});
test('mic: after permission, recognition starts, shows Listening, and a final transcript is sent', async () => {
  const h = harness(); assert.equal(await h.mic.toggle(), 'listening');
  assert.deepEqual(h.log.map(x => x[0]), ['gum', 'start']); assert.equal(h.ui.listening.at(-1), true); assert.match(h.last()[1], /Listening/);
  h.recs[0].onresult({ results: [Object.assign([{ transcript: 'Helper C can take it' }], { isFinal: true })] });
  h.recs[0].onend();
  assert.deepEqual(h.log.at(-1), ['text', 'Helper C can take it']); assert.equal(h.last()[0], 'ok'); assert.equal(h.track.stopped, true); assert.equal(h.ui.listening.at(-1), false);
});
test('mic: denied permission shows how to allow it (site and macOS cases)', async () => {
  let h = harness({ gum: Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }) });
  assert.equal(await h.mic.toggle(), 'denied'); assert.equal(h.last()[0], 'error'); assert.match(h.last()[1], /address bar → Microphone → Allow/);
  h = harness({ gum: Object.assign(new Error('Permission denied by system'), { name: 'NotAllowedError' }) });
  await h.mic.toggle(); assert.match(h.last()[1], /System Settings → Privacy & Security → Microphone/);
  assert.match(gumMessage({ name: 'NotFoundError' }), /No microphone/); assert.match(gumMessage({ name: 'NotReadableError' }), /busy/);
});
test('mic: silence ends with a visible no-speech message, not a silent reset', async () => {
  const h = harness(); await h.mic.toggle();
  h.recs[0].onerror({ error: 'no-speech' }); h.recs[0].onend();
  assert.equal(h.last()[0], 'error'); assert.match(h.last()[1], /didn’t hear anything/);
  for (const c of ['audio-capture', 'not-allowed', 'network']) assert.ok(speechMessage(c).length > 20);
});
test('mic: listening times out on its own', async () => {
  const h = harness(); await h.mic.toggle(); await new Promise(r => setTimeout(r, 80));
  assert.ok(h.log.some(x => x[0] === 'stop')); assert.equal(h.mic.state.active, false); assert.equal(h.last()[0], 'error');
});
test('mic: unsupported browsers and insecure pages get a clear message', async () => {
  assert.equal(await harness({ noMedia: true }).mic.toggle(), 'unsupported');
  const h = harness({ secure: false }); assert.equal(await h.mic.toggle(), 'insecure'); assert.match(h.last()[1], /https/);
  const n = harness({ Rec: null }); assert.equal(await n.mic.toggle(), 'no-recognition'); assert.match(n.last()[1], /can’t turn speech into text/);
});
test('mic: tapping again stops listening', async () => {
  const h = harness(); await h.mic.toggle(); assert.equal(await h.mic.toggle(), 'stopped');
  assert.equal(h.mic.state.active, false); assert.equal(h.last()[1], 'Stopped listening.');
});
test('page + worker: status/level elements exist and the Worker allows the mic for itself', () => {
  const html = readFileSync(new URL('page.html', import.meta.url), 'utf8');
  assert.match(html, /id="micstatus" role="status" aria-live="polite"/); assert.match(html, /id="miclevel"/);
  const worker = readFileSync(new URL('worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /'permissions-policy': 'microphone=\(self\)/);
  const client = readFileSync(new URL('client.mjs', import.meta.url), 'utf8');
  assert.match(client, /\$\('#mic'\)\.onclick = \(\) => \{[^}]*mic\.toggle\(\)/);
});

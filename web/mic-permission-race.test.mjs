import test from 'node:test';
import assert from 'node:assert/strict';
import { createMic } from './mic.mjs';

function fixture() {
  const pending = [], tracks = [], recs = [], statuses = [];
  class Rec { constructor() { recs.push(this); } start() {} stop() { this.onend?.(); } }
  const mic = createMic({
    window: { isSecureContext: true }, Rec, timeoutMs: 1000,
    navigator: { mediaDevices: { getUserMedia() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } } },
    ui: { status: (text, kind) => statuses.push({ text, kind }), listening() {}, level() {} }, onText() {}
  });
  function grant(index) {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks[index] = track;
    pending[index].resolve({ getTracks: () => [track] }); return track;
  }
  function cleanup() { clearTimeout(mic.state.timer); tracks.forEach(t => t.stop()); }
  return { mic, pending, tracks, recs, statuses, grant, cleanup };
}

test('cancelled permission request cannot start recognition when a later attempt is pending', async () => {
  const h = fixture(); const first = h.mic.toggle(); await h.mic.toggle(); const second = h.mic.toggle();
  try {
    const staleTrack = h.grant(0); const firstResult = await first;
    assert.equal(staleTrack.stopped, true, 'a cancelled request must release its late microphone stream');
    assert.equal(h.recs.length, 0, 'no recognizer may start before the current permission request resolves');
    assert.equal(firstResult, 'stopped');
    const currentTrack = h.grant(1); assert.equal(await second, 'listening');
    assert.equal(currentTrack.stopped, false); assert.equal(h.recs.length, 1);
    await h.mic.toggle(); assert.equal(currentTrack.stopped, true);
  } finally { if (!h.tracks[1]) { h.grant(1); await second; } h.cleanup(); }
});

test('late denial of cancelled permission request cannot stop a newer active microphone', async () => {
  const h = fixture(); const first = h.mic.toggle(); await h.mic.toggle(); const second = h.mic.toggle();
  try {
    const currentTrack = h.grant(1); assert.equal(await second, 'listening');
    const statusCount = h.statuses.length;
    h.pending[0].reject(Object.assign(new Error('Old permission request denied'), { name: 'NotAllowedError' }));
    assert.equal(await first, 'stopped');
    assert.equal(h.mic.state.active, true, 'old denial must not cancel the current attempt');
    assert.equal(currentTrack.stopped, false, 'old denial must not stop the current microphone track');
    assert.equal(h.statuses.length, statusCount, 'old error must not overwrite the current listening status');
    await h.mic.toggle(); assert.equal(currentTrack.stopped, true);
  } finally { h.cleanup(); }
});

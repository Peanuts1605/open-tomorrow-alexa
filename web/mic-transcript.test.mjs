import test from 'node:test';
import assert from 'node:assert/strict';
import { createMic, normalizeTranscript, readResults } from './mic.mjs';

const seg = (alts, isFinal = true) => Object.assign(alts.map(transcript => ({ transcript })), { isFinal });

test('transcript: common mishearings of the helper names are mapped back', () => {
  assert.equal(normalizeTranscript('help her see can take the delivery'), 'Helper C can take the delivery');
  assert.equal(normalizeTranscript('give it to helper sea'), 'give it to Helper C');
  assert.equal(normalizeTranscript('helper be said yes'), 'Helper B said yes');
  assert.equal(normalizeTranscript('hyper a can’t come'), 'Helper A can’t come');
  assert.equal(normalizeTranscript('who is free'), 'who is free');
  assert.equal(normalizeTranscript('I see the shop'), 'I see the shop');
});
test('transcript: every segment is kept, not only the last one', () => {
  const r = readResults([seg(['Helper C']), seg(['can take the delivery'])]);
  assert.deepEqual(r, { text: 'Helper C can take the delivery', isFinal: true });
  assert.equal(readResults([seg(['Helper C']), seg(['can'], false)]).isFinal, false);
});
test('transcript: the alternative that matches the page vocabulary wins; ties keep the first', () => {
  assert.equal(readResults([seg(['hello percy can take the delivery', 'Helper C can take the delivery'])]).text, 'Helper C can take the delivery');
  assert.equal(readResults([seg(['who is free', 'who is three'])]).text, 'who is free');
});
test('mic: asks for 5 alternatives and sends the vocabulary-matched, joined transcript', async () => {
  const recs = [], sent = [];
  class FakeRec { constructor() { recs.push(this); } start() {} stop() { this.onend?.(); } }
  const track = { stop() {} };
  const mic = createMic({
    window: { isSecureContext: true }, navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) } },
    Rec: FakeRec, timeoutMs: 50, ui: { status() {}, listening() {}, level() {} }, onText: t => sent.push(t)
  });
  await mic.toggle();
  assert.equal(recs[0].maxAlternatives, 5); assert.equal(recs[0].lang, 'en-US');
  recs[0].onresult({ results: [seg(['help her see']), seg(['can take the delivery', 'can take the delivered'])] });
  recs[0].onend();
  assert.deepEqual(sent, ['Helper C can take the delivery']);
});

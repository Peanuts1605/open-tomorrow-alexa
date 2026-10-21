import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBareYes } from './intent.mjs';

test('a bare yes is recognised', () => {
  for (const s of ['yes', 'Yes.', 'YES!', ' yeah ', 'yep', 'Yup', 'correct', 'That’s right', "that's right.", 'Alexa, yes', 'yes please'])
    assert.equal(isBareYes(s), true, s);
});

test('longer or different replies are not a bare yes', () => {
  for (const s of ['', 'no', 'yes, Helper B said yes', 'Helper B said yes', 'yesterday', 'not yet', 'yes but add the till', 'right now who is free'])
    assert.equal(isBareYes(s), false, s);
});

test('the router only treats a bare yes as confirming the list when Alexa asked for it', () => {
  const src = readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');
  assert.match(src, /state\.nextAction\?\.code === 'CONFIRM_ENTERED_SCOPE' && isBareYes\(text\)/);
});

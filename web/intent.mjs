// Pure helpers for the free-text router (kept separate so they can be unit-tested without a browser).

// A short, standalone "yes" (e.g. "yes", "yep.", "yeah!", "correct", "that's right").
// Only used to answer Alexa's "is that every task?" question; anything longer goes through the normal router.
export function isBareYes(raw) {
  const text = String(raw).replace(/[’‘]/g, "'").trim().toLowerCase().replace(/^alexa[, ]+/, '').replace(/[.!\s]+$/, '');
  return /^(yes|yeah|yep|yup|yes please|correct|that'?s right|right)$/.test(text);
}

// The deterministic router's categories. web/client.mjs route() uses exactly these patterns, in this order,
// and the Workers AI layer (web/ai.mjs) must emit sentences that land in the intended category.
export const CANT_COME = /\b(can'?t|cannot|can not|won'?t|isn'?t|not)\s+(come|make it|do it|work|coming|able|available)|cancel|called (in )?sick|is (out|sick|off)|dropped out|bail/i;
export const SAID_YES = /\b(said|says|say) (yes|ok|okay)|accept|agreed|is in\b|confirmed it|on board/i;
export const ASSIGN = /\b(give|assign|hand|move|put|switch|send)\b|\bcan (take|do|cover|handle|have)\b|\bwill (take|do|cover|handle)\b|\b(take|takes|cover|covers)\b/i;
export const CONFIRM = /that'?s (everything|all|it)|nothing else|full list|confirm/i;
export const WHO_FREE = /who'?s? (is )?(free|available|around)|anyone (free|available|else)|who (else )?can/i;
export const STATUS = /uncovered|stand|covered|status|gap|left|missing|are we (good|ok|okay|set)|check|how('?s| is| are)/i;

// Which branch of route() a sentence takes, given whether it names a helper. Mirrors route() order exactly.
export function classify(raw, { hasPerson = false, awaitingScope = false } = {}) {
  const text = String(raw).replace(/[’‘]/g, "'").trim();
  if (CANT_COME.test(text)) return 'cancel';
  if (SAID_YES.test(text) && !/that'?s (everything|all)/i.test(text)) return 'accept';
  if (hasPerson && ASSIGN.test(text)) return 'assign';
  if (CONFIRM.test(text) || (awaitingScope && isBareYes(text))) return 'confirm_scope';
  if (WHO_FREE.test(text)) return 'who_free';
  if (STATUS.test(text)) return 'status';
  return 'unknown';
}

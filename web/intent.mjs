// Pure helpers for the free-text router (kept separate so they can be unit-tested without a browser).

// A short, standalone "yes" (e.g. "yes", "yep.", "yeah!", "correct", "that's right").
// Only used to answer Alexa's "is that every task?" question; anything longer goes through the normal router.
export function isBareYes(raw) {
  const text = String(raw).replace(/[’‘]/g, "'").trim().toLowerCase().replace(/^alexa[, ]+/, '').replace(/[.!\s]+$/, '');
  return /^(yes|yeah|yep|yup|yes please|correct|that'?s right|right)$/.test(text);
}

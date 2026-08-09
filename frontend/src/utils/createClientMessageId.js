// Generates the idempotency key sent as `clientMessageId` on POST /sia/ask.
//
// The backend (backend/sia/idempotencyService.js) treats
// (userId, clientMessageId) as THE request identity: a repeated request
// with the same key replays the original stored answer instead of invoking
// the LLM again. That only holds if the key is genuinely unique per
// logical question -- a colliding key would make one user's question
// replay another's answer, so a timestamp or Math.random() is not
// acceptable here.
//
// Kept well inside the backend's 100-character maximum (a UUID v4 is 36
// characters; the fallback below is 36 as well).

const HEX = "0123456789abcdef";

// RFC-4122-shaped v4 identifier built from crypto.getRandomValues, for
// browsers/environments that expose Web Crypto but not randomUUID (which
// is comparatively recent, and is absent from jsdom in some versions).
const fromRandomValues = (cryptoObj) => {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);

  // Version 4 and RFC-4122 variant bits, exactly as randomUUID would set.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let out = "";
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return out;
};

export const createClientMessageId = () => {
  // `window` rather than `globalThis`: this is a browser-only app and the
  // project's eslint environment (eslint-config-react-app) defines browser
  // globals, so `globalThis` trips no-undef and would fail the CI build.
  const cryptoObj = typeof window !== "undefined" ? window.crypto : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    return fromRandomValues(cryptoObj);
  }

  // No Web Crypto at all. Rather than silently downgrading to a weak,
  // collision-prone identifier -- which would quietly break the backend's
  // idempotency guarantee -- fail loudly. Every browser this app supports
  // provides at least getRandomValues over HTTPS.
  throw new Error("Secure random source unavailable: cannot generate a SIA request key.");
};

export default createClientMessageId;

// Generates the idempotency key sent as `clientMessageId` on POST /sia/ask.

const HEX = "0123456789abcdef";

// RFC-4122-shaped v4 identifier built from crypto.getRandomValues, for
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
  const cryptoObj = typeof window !== "undefined" ? window.crypto : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    return fromRandomValues(cryptoObj);
  }

  // No Web Crypto at all. Rather than silently downgrading to a weak,
  throw new Error("Secure random source unavailable: cannot generate a SIA request key.");
};

export default createClientMessageId;

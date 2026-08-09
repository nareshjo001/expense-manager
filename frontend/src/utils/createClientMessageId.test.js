import { createClientMessageId } from "./createClientMessageId";

// The key must be collision-resistant: a duplicate would make the backend
// (which treats (userId, clientMessageId) as the request identity) replay
// the wrong stored answer.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("frontend/src/utils/createClientMessageId", () => {
  const originalCrypto = window.crypto;

  afterEach(() => {
    Object.defineProperty(window, "crypto", {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  });

  function setCrypto(value) {
    Object.defineProperty(window, "crypto", {
      value,
      configurable: true,
      writable: true,
    });
  }

  it("prefers crypto.randomUUID when available", () => {
    const randomUUID = jest.fn(() => "11111111-2222-4333-8444-555555555555");
    setCrypto({ randomUUID });

    expect(createClientMessageId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("falls back to crypto.getRandomValues and still produces a valid v4 shape", () => {
    setCrypto({
      getRandomValues: (bytes) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i * 7 + 3;
        return bytes;
      },
    });

    const id = createClientMessageId();
    expect(id).toMatch(UUID_SHAPE);
  });

  it("throws rather than silently producing a weak key when no secure source exists", () => {
    setCrypto(undefined);
    expect(() => createClientMessageId()).toThrow(/Secure random source unavailable/);
  });

  // The two tests below set a real random source explicitly rather than
  // relying on whatever the jsdom version happens to expose -- this
  // environment's `crypto` provides neither randomUUID nor
  // getRandomValues, so depending on it would make these assertions test
  // the test environment instead of the code.
  it("stays within the backend's 100-character maximum", () => {
    setCrypto({ getRandomValues: (bytes) => bytes.map(() => Math.floor(Math.random() * 256)) });

    expect(createClientMessageId().length).toBeLessThanOrEqual(100);
  });

  it("produces distinct values across calls", () => {
    let counter = 0;
    setCrypto({
      getRandomValues: (bytes) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (counter + i * 31) % 256;
        counter += 1;
        return bytes;
      },
    });

    const ids = new Set(Array.from({ length: 50 }, () => createClientMessageId()));
    expect(ids.size).toBe(50);
  });
});

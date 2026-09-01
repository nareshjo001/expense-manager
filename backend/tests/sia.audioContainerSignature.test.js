// Unit tests for backend/sia/audioContainerSignature.js -- POST
"use strict";

const {
  detectContainerType,
  mimeTypeForContainer,
  MIME_TYPE_BY_CONTAINER,
} = require("../sia/audioContainerSignature");

function padTo(buffer, length) {
  if (buffer.length >= length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(length - buffer.length)]);
}

function webmFixture() {
  return padTo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]), 16);
}

function oggFixture() {
  return padTo(Buffer.from("OggS", "ascii"), 16);
}

function wavFixture() {
  const buffer = Buffer.alloc(16);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(8, 4); // chunk size -- arbitrary, never checked
  buffer.write("WAVE", 8, "ascii");
  return buffer;
}

function mp4Fixture() {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32BE(0x18, 0); // box size -- arbitrary, never checked
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return buffer;
}

describe("sia/audioContainerSignature -- detectContainerType()", () => {
  it("detects a WebM/EBML header", () => {
    expect(detectContainerType(webmFixture())).toBe("webm");
  });

  it("detects an Ogg capture pattern", () => {
    expect(detectContainerType(oggFixture())).toBe("ogg");
  });

  it("detects a WAV RIFF/WAVE header", () => {
    expect(detectContainerType(wavFixture())).toBe("wav");
  });

  it("detects an MP4/M4A ftyp box", () => {
    expect(detectContainerType(mp4Fixture())).toBe("mp4");
  });

  it("returns null for a plain text file renamed to .webm (real bytes don't match any signature)", () => {
    const textBuffer = Buffer.from("this is just plain text, not audio at all!!", "utf8");
    expect(detectContainerType(textBuffer)).toBeNull();
  });

  it("returns null for a MIME-header lie -- bytes that don't match their claimed container", () => {
    // Genuinely a text buffer, but a caller might have paired it with a
    const fakedBuffer = Buffer.from("Content-Type says audio/webm but I am not.", "utf8");
    expect(detectContainerType(fakedBuffer)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(detectContainerType(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a too-short buffer (fewer than 12 bytes)", () => {
    expect(detectContainerType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull();
  });

  it("returns null for a non-Buffer input", () => {
    expect(detectContainerType("not a buffer")).toBeNull();
    expect(detectContainerType(null)).toBeNull();
    expect(detectContainerType(undefined)).toBeNull();
    expect(detectContainerType({ length: 100 })).toBeNull();
  });

  it("returns null for random unrecognized binary bytes", () => {
    const randomBuffer = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    expect(detectContainerType(randomBuffer)).toBeNull();
  });

  it("does not misclassify a WAV-like buffer missing the WAVE form type", () => {
    const buffer = Buffer.alloc(16);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("AVI ", 8, "ascii"); // a real RIFF form type, just not WAVE
    expect(detectContainerType(buffer)).toBeNull();
  });

  it("does not misclassify an MP4-like buffer missing the ftyp box", () => {
    const buffer = Buffer.alloc(16);
    buffer.write("nope", 4, "ascii");
    expect(detectContainerType(buffer)).toBeNull();
  });
});

describe("sia/audioContainerSignature -- mimeTypeForContainer()", () => {
  it("maps every detected container type to its documented MIME string", () => {
    expect(mimeTypeForContainer("webm")).toBe("audio/webm");
    expect(mimeTypeForContainer("ogg")).toBe("audio/ogg");
    expect(mimeTypeForContainer("wav")).toBe("audio/wav");
    expect(mimeTypeForContainer("mp4")).toBe("audio/mp4");
  });

  it("returns null for an unrecognized container key", () => {
    expect(mimeTypeForContainer("flac")).toBeNull();
    expect(mimeTypeForContainer(null)).toBeNull();
    expect(mimeTypeForContainer(undefined)).toBeNull();
  });

  it("MIME_TYPE_BY_CONTAINER matches the four documented accepted MIME types exactly", () => {
    expect(Object.values(MIME_TYPE_BY_CONTAINER).sort()).toEqual(
      ["audio/mp4", "audio/ogg", "audio/wav", "audio/webm"].sort()
    );
  });
});

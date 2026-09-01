import api from "./axios";
import { transcribeSiaAudio } from "./siaVoiceApi";

// Matches this repository's existing convention (see siaApi.test.js): the
jest.mock("./axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const TRANSCRIPTION_RESPONSE = {
  success: true,
  transcript: "how much did I spend this month",
  detectedLanguage: "en",
  durationMs: 1800,
};

afterEach(() => {
  jest.clearAllMocks();
});

function makeAudioBlob() {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
}

describe("frontend/src/api/siaVoiceApi transcribeSiaAudio Content-Type contract", () => {
  it("never sends a static application/json Content-Type for the multipart upload", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });

    await transcribeSiaAudio({ audioBlob: makeAudioBlob() });

    const [, , config] = api.post.mock.calls[0];
    // Explicitly unset, not the shared instance's default string -- this is
    expect(config.headers["Content-Type"]).toBeUndefined();
    expect("Content-Type" in config.headers).toBe(true);
    expect(config.headers["Content-Type"]).not.toBe("application/json");
  });

  it("posts the real FormData body unchanged (never JSON-stringified) under field name 'audio'", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });
    const audioBlob = makeAudioBlob();

    await transcribeSiaAudio({ audioBlob });

    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/sia/transcriptions");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("audio")).toBeInstanceOf(Blob);
  });

  it("the installed transformRequest hook removes Content-Type via AxiosHeaders' delete() API and leaves the body untouched", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });
    const audioBlob = makeAudioBlob();

    await transcribeSiaAudio({ audioBlob });

    const [, , config] = api.post.mock.calls[0];
    const deleteSpy = jest.fn();
    const fakeAxiosHeaders = { delete: deleteSpy };
    const formData = new FormData();

    const result = config.transformRequest(formData, fakeAxiosHeaders);

    expect(deleteSpy).toHaveBeenCalledWith("Content-Type");
    expect(result).toBe(formData);
  });

  it("the installed transformRequest hook also strips a plain-object Content-Type key (pre-v1/mocked axios shape)", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });
    const audioBlob = makeAudioBlob();

    await transcribeSiaAudio({ audioBlob });

    const [, , config] = api.post.mock.calls[0];
    const plainHeaders = { "Content-Type": "application/json", Authorization: "Bearer x" };

    const formData = new FormData();
    const result = config.transformRequest(formData, plainHeaders);

    expect(plainHeaders["Content-Type"]).toBeUndefined();
    expect(plainHeaders.Authorization).toBe("Bearer x");
    expect(result).toBe(formData);
  });

  it("appends languageHint only when supplied", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });

    await transcribeSiaAudio({ audioBlob: makeAudioBlob(), languageHint: "en" });
    const [, formDataWithHint] = api.post.mock.calls[0];
    expect(formDataWithHint.get("languageHint")).toBe("en");

    await transcribeSiaAudio({ audioBlob: makeAudioBlob() });
    const [, formDataWithoutHint] = api.post.mock.calls[1];
    expect(formDataWithoutHint.get("languageHint")).toBeNull();
  });

  it("returns the exact response.data object unchanged", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });

    const result = await transcribeSiaAudio({ audioBlob: makeAudioBlob() });

    expect(result).toBe(TRANSCRIPTION_RESPONSE);
  });

  it("forwards an AbortController signal so an in-flight request can be cancelled", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });
    const controller = new AbortController();

    await transcribeSiaAudio({ audioBlob: makeAudioBlob(), signal: controller.signal });

    const [, , config] = api.post.mock.calls[0];
    expect(config.signal).toBe(controller.signal);
  });

  it("propagates a rejected request unchanged (no automatic retry at this layer)", async () => {
    const failure = new Error("Request failed with status code 422");
    failure.response = {
      status: 422,
      data: { success: false, message: "The audio could not be processed (no speech detected)." },
    };
    api.post.mockRejectedValue(failure);

    await expect(transcribeSiaAudio({ audioBlob: makeAudioBlob() })).rejects.toBe(failure);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("never performs a real network call -- the shared axios instance is fully mocked", async () => {
    api.post.mockResolvedValue({ data: TRANSCRIPTION_RESPONSE });

    await transcribeSiaAudio({ audioBlob: makeAudioBlob() });

    expect(jest.isMockFunction(api.post)).toBe(true);
  });
});

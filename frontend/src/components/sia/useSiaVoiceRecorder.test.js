import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useSiaVoiceRecorder,
  SIA_RECORDER_STATE,
  pickSupportedMimeType,
  isVoiceRecordingSupported,
} from "./useSiaVoiceRecorder";
import { transcribeSiaAudio } from "../../api/siaVoiceApi";

jest.mock("../../api/siaVoiceApi", () => ({
  transcribeSiaAudio: jest.fn(),
}));

// ---------------------------------------------------------------------
// A jsdom-compatible MediaRecorder/getUserMedia mock. Real browsers fire
// `stop`/`dataavailable` asynchronously; this mock mirrors that by
// resolving on a microtask (queueMicrotask), NOT a macrotask, so it works
// correctly under Jest fake timers (which only control macrotasks) without
// needing `jest.advanceTimersByTime` to observe recording-stop effects.
// ---------------------------------------------------------------------
class MockTrack {
  constructor() {
    this.stop = jest.fn();
  }
}

class MockStream {
  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new MockTrack());
  }
  getTracks() {
    return this.tracks;
  }
}

let lastRecorderInstance = null;

class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = (options && options.mimeType) || "audio/webm";
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    lastRecorderInstance = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    }
    queueMicrotask(() => {
      if (this.onstop) this.onstop();
    });
  }
}
MockMediaRecorder.isTypeSupported = jest.fn(() => true);

function installBrowserMocks({ getUserMediaImpl, isTypeSupportedImpl } = {}) {
  MockMediaRecorder.isTypeSupported = jest.fn(isTypeSupportedImpl || (() => true));
  window.MediaRecorder = MockMediaRecorder;
  global.MediaRecorder = MockMediaRecorder;

  const getUserMedia =
    getUserMediaImpl || jest.fn(() => Promise.resolve(new MockStream(2)));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia };
}

function uninstallBrowserMocks() {
  delete window.MediaRecorder;
  delete global.MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
}

afterEach(() => {
  uninstallBrowserMocks();
  jest.clearAllMocks();
  jest.useRealTimers();
  lastRecorderInstance = null;
});

describe("pickSupportedMimeType", () => {
  it("prefers audio/webm;codecs=opus when supported", () => {
    const isTypeSupported = (t) => t === "audio/webm;codecs=opus";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 when opus webm is unsupported", () => {
    const isTypeSupported = (t) => t === "audio/mp4";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/mp4");
  });

  it("falls back to audio/webm (no codec) when mp4 is unsupported", () => {
    const isTypeSupported = (t) => t === "audio/webm";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/webm");
  });

  it("falls back to audio/ogg;codecs=opus as the last resort", () => {
    const isTypeSupported = (t) => t === "audio/ogg;codecs=opus";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/ogg;codecs=opus");
  });

  it("returns undefined when nothing in the preference list is supported", () => {
    expect(pickSupportedMimeType(() => false)).toBeUndefined();
  });

  it("returns undefined (never throws) when isTypeSupported itself throws", () => {
    expect(pickSupportedMimeType(() => { throw new Error("boom"); })).toBeUndefined();
  });

  it("respects preference order over first-supported-in-list-order (webm opus beats mp4 when both supported)", () => {
    const isTypeSupported = (t) => t === "audio/webm;codecs=opus" || t === "audio/mp4";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/webm;codecs=opus");
  });
});

describe("isVoiceRecordingSupported", () => {
  it("is false with no getUserMedia/MediaRecorder installed", () => {
    uninstallBrowserMocks();
    expect(isVoiceRecordingSupported()).toBe(false);
  });

  it("is true once both getUserMedia and MediaRecorder are present", () => {
    installBrowserMocks();
    expect(isVoiceRecordingSupported()).toBe(true);
  });
});

describe("useSiaVoiceRecorder", () => {
  it("starts in idle", () => {
    installBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));
    expect(result.current.state).toBe(SIA_RECORDER_STATE.IDLE);
  });

  it("goes straight to unsupported when the browser lacks getUserMedia/MediaRecorder, and never calls getUserMedia", async () => {
    uninstallBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.UNSUPPORTED);
  });

  it("permission granted: requesting_permission -> recording", async () => {
    installBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    let startPromise;
    act(() => {
      startPromise = result.current.start();
    });
    // Immediately after calling start (before the getUserMedia promise
    // resolves) the machine must already show requesting_permission.
    expect(result.current.state).toBe(SIA_RECORDER_STATE.REQUESTING_PERMISSION);

    await act(async () => {
      await startPromise;
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.RECORDING);
  });

  it("permission denied (NotAllowedError) -> permission_denied, and the mic is never opened", async () => {
    const getUserMedia = jest.fn(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
    installBrowserMocks({ getUserMediaImpl: getUserMedia });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.PERMISSION_DENIED);
  });

  it("permission dismissed (also NotAllowedError in most browsers) resolves to permission_denied, not a stuck requesting_permission", async () => {
    const getUserMedia = jest.fn(() =>
      Promise.reject(Object.assign(new Error("dismissed"), { name: "NotAllowedError" }))
    );
    installBrowserMocks({ getUserMediaImpl: getUserMedia });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).not.toBe(SIA_RECORDER_STATE.REQUESTING_PERMISSION);
    expect(result.current.state).toBe(SIA_RECORDER_STATE.PERMISSION_DENIED);
  });

  it("missing device (NotFoundError) -> no_microphone", async () => {
    const getUserMedia = jest.fn(() => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })));
    installBrowserMocks({ getUserMediaImpl: getUserMedia });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.NO_MICROPHONE);
  });

  it("device busy (NotReadableError) -> device_busy", async () => {
    const getUserMedia = jest.fn(() =>
      Promise.reject(Object.assign(new Error("busy"), { name: "NotReadableError" }))
    );
    installBrowserMocks({ getUserMediaImpl: getUserMedia });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.DEVICE_BUSY);
  });

  it("stop() moves recording -> stopping -> transcribing -> review_ready, and calls the transcription API exactly once", async () => {
    installBrowserMocks();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "why did my spending change" });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe(SIA_RECORDER_STATE.RECORDING);

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.REVIEW_READY));
    expect(result.current.transcript).toBe("why did my spending change");
    expect(transcribeSiaAudio).toHaveBeenCalledTimes(1);
  });

  it("cancel() during recording stops all tracks and never calls the transcription API", async () => {
    installBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    const tracks = lastRecorderInstance.stream.getTracks();

    await act(async () => {
      result.current.cancel();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.CANCELLED));
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1));
    expect(transcribeSiaAudio).not.toHaveBeenCalled();
  });

  it("cancel() while transcribing aborts the in-flight request and settles to cancelled, discarding the result even if the API later resolves", async () => {
    installBrowserMocks();
    let resolveTranscription;
    transcribeSiaAudio.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        })
    );
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.TRANSCRIBING));

    const [, config] = transcribeSiaAudio.mock.calls[0];
    // eslint-disable-next-line no-unused-vars
    void config;
    const signal = transcribeSiaAudio.mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);

    await act(async () => {
      result.current.cancel();
    });

    expect(signal.aborted).toBe(true);

    await act(async () => {
      resolveTranscription({ success: true, transcript: "late answer" });
      await Promise.resolve();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.CANCELLED);
    expect(result.current.transcript).toBeNull();
  });

  it("auto-stops at maxDurationSeconds using fake timers, calling MediaRecorder.stop", async () => {
    jest.useFakeTimers();
    installBrowserMocks();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "auto stopped" });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 5 }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe(SIA_RECORDER_STATE.RECORDING);
    const recorderStopSpy = jest.spyOn(lastRecorderInstance, "stop");

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(recorderStopSpy).toHaveBeenCalledTimes(1);
    expect(result.current.state).not.toBe(SIA_RECORDER_STATE.RECORDING);
  });

  it("elapsedSeconds increments once per second while recording (fake timers)", async () => {
    jest.useFakeTimers();
    installBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.elapsedSeconds).toBe(0);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedSeconds).toBe(3);
  });

  it("a failed transcription (no-speech, 422) is not automatically retried -- the API is called exactly once", async () => {
    installBrowserMocks();
    const err = new Error("no speech");
    err.response = { status: 422, data: { success: false, message: "The audio could not be processed (no speech detected)." } };
    transcribeSiaAudio.mockRejectedValue(err);
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.NO_SPEECH));
    expect(transcribeSiaAudio).toHaveBeenCalledTimes(1);
  });

  it("maps a 503 transcription failure to provider_unavailable", async () => {
    installBrowserMocks();
    const err = new Error("unavailable");
    err.response = { status: 503, data: { success: false, message: "SIA voice input is temporarily unavailable." } };
    transcribeSiaAudio.mockRejectedValue(err);
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.PROVIDER_UNAVAILABLE));
  });

  it("maps a response-less (network) transcription failure to network_error", async () => {
    installBrowserMocks();
    transcribeSiaAudio.mockRejectedValue(new Error("Network Error"));
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.NETWORK_ERROR));
  });

  it("stops every MediaStreamTrack on the success exit path", async () => {
    installBrowserMocks();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "ok" });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    const tracks = lastRecorderInstance.stream.getTracks();

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.REVIEW_READY));
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1));
  });

  it("stops every MediaStreamTrack on the failure exit path", async () => {
    installBrowserMocks();
    const err = new Error("no speech");
    err.response = { status: 422, data: { message: "no speech" } };
    transcribeSiaAudio.mockRejectedValue(err);
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    const tracks = lastRecorderInstance.stream.getTracks();

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.NO_SPEECH));
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1));
  });

  it("stops every MediaStreamTrack on unmount while recording, and aborts nothing extra since no upload was in flight", async () => {
    installBrowserMocks();
    const { result, unmount } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    const tracks = lastRecorderInstance.stream.getTracks();

    unmount();

    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1));
  });

  it("aborts an in-flight transcription request on unmount", async () => {
    installBrowserMocks();
    let capturedSignal;
    transcribeSiaAudio.mockImplementation(
      ({ signal }) =>
        new Promise(() => {
          capturedSignal = signal;
        })
    );
    const { result, unmount } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(transcribeSiaAudio).toHaveBeenCalledTimes(1));

    unmount();

    expect(capturedSignal.aborted).toBe(true);
  });

  it("never updates state after unmount (no act() warning) once a delayed transcription resolves post-unmount", async () => {
    installBrowserMocks();
    let resolveTranscription;
    transcribeSiaAudio.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        })
    );
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(transcribeSiaAudio).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      resolveTranscription({ success: true, transcript: "too late" });
      await Promise.resolve();
      await Promise.resolve();
    });

    const reactActWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("not wrapped in act")
    );
    expect(reactActWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });

  it("reset() returns to idle and clears any transcript/error so the next attempt starts clean", async () => {
    installBrowserMocks();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "hello" });
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.state).toBe(SIA_RECORDER_STATE.REVIEW_READY));

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe(SIA_RECORDER_STATE.IDLE);
    expect(result.current.transcript).toBeNull();
  });

  it("never generates or references a clientMessageId anywhere in its returned API", async () => {
    installBrowserMocks();
    const { result } = renderHook(() => useSiaVoiceRecorder({ maxDurationSeconds: 30 }));
    expect(Object.keys(result.current)).not.toContain("clientMessageId");
  });
});

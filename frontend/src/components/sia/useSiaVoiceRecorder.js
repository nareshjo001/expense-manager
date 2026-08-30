import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeSiaAudio } from "../../api/siaVoiceApi";

// SIA voice-input recorder state machine (Workstream 3, part A).
//
// Owns exactly one recording attempt at a time: requesting microphone
// permission, recording, auto-stopping at the server-advertised maximum
// duration, uploading for transcription, and holding the resulting
// transcript for the caller to insert into the composer -- this hook NEVER
// inserts it and NEVER submits a question itself. `clientMessageId`/the ask
// mutation are never touched anywhere in this file.
//
// Every documented state is reachable and nothing else is emitted.
export const SIA_RECORDER_STATE = Object.freeze({
  IDLE: "idle",
  REQUESTING_PERMISSION: "requesting_permission",
  RECORDING: "recording",
  STOPPING: "stopping",
  TRANSCRIBING: "transcribing",
  REVIEW_READY: "review_ready",
  PERMISSION_DENIED: "permission_denied",
  NO_MICROPHONE: "no_microphone",
  DEVICE_BUSY: "device_busy",
  UNSUPPORTED: "unsupported",
  TOO_LONG: "too_long",
  NO_SPEECH: "no_speech",
  NETWORK_ERROR: "network_error",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  CANCELLED: "cancelled",
});

// Preference order this milestone requires -- checked via
// MediaRecorder.isTypeSupported, first match wins. A browser lacking all
// four simply gets `undefined`, and MediaRecorder is created with no
// explicit mimeType (the browser's own default), never a crash.
const MIME_TYPE_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

export function pickSupportedMimeType(isTypeSupported = MediaRecorder && MediaRecorder.isTypeSupported) {
  if (typeof isTypeSupported !== "function") return undefined;
  for (const candidate of MIME_TYPE_PREFERENCE) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch (_err) {
      // A throwing isTypeSupported is treated as "not supported" for that
      // candidate, never a crash.
    }
  }
  return undefined;
}

export function isVoiceRecordingSupported() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder === "function"
  );
}

// Maps a getUserMedia rejection to one of this hook's documented states.
// Names follow the DOM spec (MediaDevices.getUserMedia() exceptions);
// anything unrecognized falls back to NO_MICROPHONE rather than silently
// leaving the machine in REQUESTING_PERMISSION forever.
function mapGetUserMediaError(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return SIA_RECORDER_STATE.PERMISSION_DENIED;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return SIA_RECORDER_STATE.NO_MICROPHONE;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return SIA_RECORDER_STATE.DEVICE_BUSY;
  }
  return SIA_RECORDER_STATE.NO_MICROPHONE;
}

// Maps a rejected transcription request (axios error) to one of this
// hook's documented states, mirroring backend/Controllers/SiaControllers/
// transcribe.js's documented status codes exactly.
function mapTranscriptionError(error) {
  if (error && (error.code === "ERR_CANCELED" || error.name === "CanceledError")) {
    return SIA_RECORDER_STATE.CANCELLED;
  }
  const status = error && error.response && error.response.status;
  if (status === 422) return SIA_RECORDER_STATE.NO_SPEECH;
  if (status === 413) return SIA_RECORDER_STATE.TOO_LONG;
  if (status === 503) return SIA_RECORDER_STATE.PROVIDER_UNAVAILABLE;
  if (!error || !error.response) return SIA_RECORDER_STATE.NETWORK_ERROR;
  return SIA_RECORDER_STATE.PROVIDER_UNAVAILABLE;
}

const DEFAULT_MAX_DURATION_SECONDS = 60;

/**
 * @param {object} args
 * @param {number} [args.maxDurationSeconds] - from GET /sia/status's
 *   capabilities.voiceInput.maxDurationSeconds (read by the caller, e.g.
 *   SiaEntryPoint's existing useSiaStatusQuery -- this hook does not fetch
 *   status itself).
 * @param {string} [args.languageHint]
 */
export function useSiaVoiceRecorder({ maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS, languageHint } = {}) {
  const [state, setState] = useState(SIA_RECORDER_STATE.IDLE);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcript, setTranscript] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const abortControllerRef = useRef(null);
  const cancelledRef = useRef(false);
  const isMountedRef = useRef(true);
  const tickIntervalRef = useRef(null);
  const maxDurationTimeoutRef = useRef(null);

  const safeSetState = useCallback((next) => {
    if (isMountedRef.current) setState(next);
  }, []);

  // The SINGLE cleanup path called from every exit -- success, error,
  // cancel, and unmount. Stops every MediaStreamTrack exactly once (a
  // second call after streamRef is already null is a no-op, never a
  // double-stop), clears both timers, and clears the chunk buffer so no
  // audio bytes linger after this recording attempt ends.
  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    chunksRef.current = [];
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight transcription upload and release the
      // microphone -- an unmounted panel (close/new-chat/history-nav/
      // logout) must never keep recording or keep an upload running.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTranscription = useCallback(
    async (blob) => {
      safeSetState(SIA_RECORDER_STATE.TRANSCRIBING);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await transcribeSiaAudio({ audioBlob: blob, languageHint, signal: controller.signal });
        abortControllerRef.current = null;
        if (!isMountedRef.current) return;
        if (cancelledRef.current) {
          safeSetState(SIA_RECORDER_STATE.CANCELLED);
          return;
        }
        setTranscript(typeof result?.transcript === "string" ? result.transcript : "");
        safeSetState(SIA_RECORDER_STATE.REVIEW_READY);
      } catch (err) {
        abortControllerRef.current = null;
        if (!isMountedRef.current) return;
        if (cancelledRef.current) {
          safeSetState(SIA_RECORDER_STATE.CANCELLED);
          return;
        }
        const mapped = mapTranscriptionError(err);
        setErrorMessage(
          err?.response?.data?.message ||
            (mapped === SIA_RECORDER_STATE.NETWORK_ERROR
              ? "A network error interrupted voice transcription."
              : "Voice transcription is temporarily unavailable.")
        );
        safeSetState(mapped);
      }
    },
    [languageHint, safeSetState]
  );

  // Finishes a recording that reached its natural or requested end:
  // combines the collected chunks into one Blob, releases the microphone,
  // and either discards everything (a cancel raced the stop) or hands the
  // Blob to transcription. The Blob reference itself is never retained
  // beyond this function -- it is passed to runTranscription and not
  // stored on the hook.
  const finishRecording = useCallback(() => {
    const chunks = chunksRef.current;
    const mimeType = mediaRecorderRef.current && mediaRecorderRef.current.mimeType;
    cleanup();

    if (cancelledRef.current) {
      safeSetState(SIA_RECORDER_STATE.CANCELLED);
      return;
    }

    const blob = new window.Blob(chunks, mimeType ? { type: mimeType } : undefined);
    runTranscription(blob);
  }, [cleanup, runTranscription, safeSetState]);

  const stop = useCallback(() => {
    if (state !== SIA_RECORDER_STATE.RECORDING) return;
    safeSetState(SIA_RECORDER_STATE.STOPPING);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      finishRecording();
    }
  }, [state, finishRecording, safeSetState]);

  // Safe to call unconditionally from any caller (e.g. SiaPanel wiring this
  // into New chat/history-nav/close) -- a no-op when there is nothing
  // active to cancel, so it never stomps an idle/already-settled machine
  // into a spurious "cancelled" announcement.
  const cancel = useCallback(() => {
    const activeStates = [
      SIA_RECORDER_STATE.REQUESTING_PERMISSION,
      SIA_RECORDER_STATE.RECORDING,
      SIA_RECORDER_STATE.STOPPING,
      SIA_RECORDER_STATE.TRANSCRIBING,
      SIA_RECORDER_STATE.TOO_LONG,
    ];
    if (!activeStates.includes(state)) return;

    cancelledRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      // onstop -> finishRecording() will see cancelledRef and settle into
      // CANCELLED, discarding the blob rather than transcribing it.
    } else {
      cleanup();
      safeSetState(SIA_RECORDER_STATE.CANCELLED);
    }
  }, [state, cleanup, safeSetState]);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setTranscript(null);
    setErrorMessage(null);
    setElapsedSeconds(0);
    safeSetState(SIA_RECORDER_STATE.IDLE);
  }, [safeSetState]);

  const start = useCallback(async () => {
    if (!isVoiceRecordingSupported()) {
      safeSetState(SIA_RECORDER_STATE.UNSUPPORTED);
      return;
    }
    if (
      state === SIA_RECORDER_STATE.RECORDING ||
      state === SIA_RECORDER_STATE.REQUESTING_PERMISSION ||
      state === SIA_RECORDER_STATE.TRANSCRIBING
    ) {
      return;
    }

    cancelledRef.current = false;
    setTranscript(null);
    setErrorMessage(null);
    setElapsedSeconds(0);
    safeSetState(SIA_RECORDER_STATE.REQUESTING_PERMISSION);

    let stream;
    try {
      // A DIRECT continuation of the button's own click handler -- this
      // hook never calls getUserMedia from an effect or on mount.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (!isMountedRef.current) return;
      // A cancel that arrived WHILE permission was being requested already
      // settled the machine into CANCELLED -- a late rejection must never
      // overwrite that back to e.g. permission_denied.
      if (cancelledRef.current) return;
      const mapped = mapGetUserMediaError(err);
      setErrorMessage(
        mapped === SIA_RECORDER_STATE.PERMISSION_DENIED
          ? "Microphone permission was denied."
          : mapped === SIA_RECORDER_STATE.DEVICE_BUSY
          ? "The microphone is being used by another application."
          : "No microphone was found."
      );
      safeSetState(mapped);
      return;
    }

    if (!isMountedRef.current || cancelledRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickSupportedMimeType();
    let recorder;
    try {
      recorder = mimeType ? new window.MediaRecorder(stream, { mimeType }) : new window.MediaRecorder(stream);
    } catch (_err) {
      cleanup();
      safeSetState(SIA_RECORDER_STATE.UNSUPPORTED);
      return;
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      finishRecording();
    };
    recorder.onerror = () => {
      cleanup();
      cancelledRef.current = true;
      safeSetState(SIA_RECORDER_STATE.DEVICE_BUSY);
    };

    recorder.start();
    safeSetState(SIA_RECORDER_STATE.RECORDING);

    tickIntervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    // Auto-stop at the server-advertised ceiling -- momentarily surfaces
    // TOO_LONG so the UI can announce it, then proceeds through the exact
    // same stop -> transcribe path a manual Stop press uses.
    maxDurationTimeoutRef.current = setTimeout(() => {
      safeSetState(SIA_RECORDER_STATE.TOO_LONG);
      const activeRecorder = mediaRecorderRef.current;
      if (activeRecorder && activeRecorder.state !== "inactive") {
        activeRecorder.stop();
      } else {
        finishRecording();
      }
    }, Math.max(1, maxDurationSeconds) * 1000);
  }, [state, safeSetState, cleanup, finishRecording, maxDurationSeconds]);

  return {
    state,
    elapsedSeconds,
    transcript,
    errorMessage,
    isSupported: isVoiceRecordingSupported(),
    maxDurationSeconds,
    start,
    stop,
    cancel,
    reset,
  };
}

export default useSiaVoiceRecorder;

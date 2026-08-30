import React from "react";
import { FiMic, FiSquare } from "react-icons/fi";
import { SIA_RECORDER_STATE } from "./useSiaVoiceRecorder";

// Workstream 3, part C -- the accessible mic/timer/Stop/Cancel cluster
// rendered beside SiaPanel.js's existing composer. Pure presentation: all
// state comes from the `recorder` object (useSiaVoiceRecorder.js), and
// every click here calls straight through to that hook's own start/stop/
// cancel -- this component never touches the composer's text, the ask
// mutation, or clientMessageId generation.
const ACTIVE_RECORDING_STATES = new Set([
  SIA_RECORDER_STATE.RECORDING,
  SIA_RECORDER_STATE.STOPPING,
  SIA_RECORDER_STATE.TOO_LONG,
]);

const BUSY_STATES = new Set([SIA_RECORDER_STATE.REQUESTING_PERMISSION, SIA_RECORDER_STATE.TRANSCRIBING]);

const ERROR_STATES = new Set([
  SIA_RECORDER_STATE.PERMISSION_DENIED,
  SIA_RECORDER_STATE.NO_MICROPHONE,
  SIA_RECORDER_STATE.DEVICE_BUSY,
  SIA_RECORDER_STATE.NO_SPEECH,
  SIA_RECORDER_STATE.NETWORK_ERROR,
  SIA_RECORDER_STATE.PROVIDER_UNAVAILABLE,
]);

// Never communicated by color alone -- this exact text is what the
// aria-live region below announces, and it is also shown visibly (see
// SiaPanel.js's rendering of recorder.errorMessage/this same text next to
// the control).
export function announcementForState(state) {
  switch (state) {
    case SIA_RECORDER_STATE.REQUESTING_PERMISSION:
      return "Requesting microphone permission…";
    case SIA_RECORDER_STATE.RECORDING:
      return "Recording. Press Stop when you are done.";
    case SIA_RECORDER_STATE.STOPPING:
      return "Finishing recording…";
    case SIA_RECORDER_STATE.TOO_LONG:
      return "Maximum recording length reached. Finishing recording…";
    case SIA_RECORDER_STATE.TRANSCRIBING:
      return "Transcribing your question…";
    case SIA_RECORDER_STATE.REVIEW_READY:
      return "Voice input ready. Review your question before sending.";
    case SIA_RECORDER_STATE.PERMISSION_DENIED:
      return "Microphone permission was denied.";
    case SIA_RECORDER_STATE.NO_MICROPHONE:
      return "No microphone was found.";
    case SIA_RECORDER_STATE.DEVICE_BUSY:
      return "The microphone is being used by another application.";
    case SIA_RECORDER_STATE.NO_SPEECH:
      return "No speech was detected in the recording.";
    case SIA_RECORDER_STATE.NETWORK_ERROR:
      return "A network error interrupted voice input.";
    case SIA_RECORDER_STATE.PROVIDER_UNAVAILABLE:
      return "Voice input is temporarily unavailable.";
    case SIA_RECORDER_STATE.CANCELLED:
      return "Voice input cancelled.";
    default:
      return "";
  }
}

export function formatElapsedTime(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const SiaVoiceRecorderControls = ({ recorder, disabled }) => {
  if (!recorder || !recorder.isSupported) return null;

  const { state, elapsedSeconds, maxDurationSeconds, start, stop, cancel } = recorder;
  const isRecording = ACTIVE_RECORDING_STATES.has(state);
  const isBusyState = BUSY_STATES.has(state);
  const formattedTime = formatElapsedTime(elapsedSeconds);
  const micLabel = isRecording ? `Stop recording (${formattedTime})` : "Start voice input";
  const announcement = announcementForState(state);
  const isErrorState = ERROR_STATES.has(state);

  const handleMicClick = () => {
    if (isRecording) {
      stop();
    } else {
      start();
    }
  };

  return (
    <div className="sia-voice-controls">
      <div className="sia-voice-controls-row">
        <button
          type="button"
          className="sia-icon-btn sia-mic-btn"
          aria-pressed={isRecording}
          aria-label={micLabel}
          onClick={handleMicClick}
          disabled={disabled || isBusyState}
        >
          <span aria-hidden="true">{isRecording ? <FiSquare /> : <FiMic />}</span>
        </button>

        {isRecording && (
          <>
            <span className="sia-voice-timer" aria-hidden="true">
              {formattedTime}
              {typeof maxDurationSeconds === "number" ? ` / ${formatElapsedTime(maxDurationSeconds)}` : ""}
            </span>
            <button type="button" className="sia-secondary-btn sia-voice-stop-btn" onClick={stop}>
              Stop
            </button>
            <button type="button" className="sia-secondary-btn sia-voice-cancel-btn" onClick={cancel}>
              Cancel
            </button>
          </>
        )}
      </div>

      {isErrorState && recorder.errorMessage && (
        <p className="sia-error sia-voice-error" role="alert">
          {recorder.errorMessage}
        </p>
      )}

      {/* Never color-alone: this text is the single source of truth for
          every state transition announced to assistive tech. */}
      <p className="sia-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
};

export default SiaVoiceRecorderControls;

import React, { useEffect, useState } from "react";

// Workstream 3, part F -- an explicit, NEVER-autoplaying "Listen"/"Stop"
// control for one assistant answer, built on the browser's own
// speechSynthesis API. Feature-detected: renders nothing at all when
// `window.speechSynthesis` is unavailable, so ordinary text rendering
// (SiaPanel.js's plain <p>) is completely unaffected either way.
//
// Speaks ONLY the exact answer text passed in -- never grounding
// internals, interpretation metadata, or (for a clarification message) the
// option list as a batch. SiaPanel.js is the caller and is the one place
// that decides what text this component ever receives.
function isSpeechSynthesisAvailable() {
  return typeof window !== "undefined" && Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === "function";
}

// `stopSignal` is any value that changes when the caller wants speech
// stopped as a side effect of something else happening (panel close, new
// chat, logout, the active message changing, unmount) -- SiaPanel.js
// passes a value that changes on exactly those transitions. This keeps
// the "stop on N different triggers" contract to ONE cleanup effect here,
// rather than duplicating speechSynthesis.cancel() calls at every call
// site.
const SiaSpeakButton = ({ text, stopSignal }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const available = isSpeechSynthesisAvailable();

  // The single cleanup path: cancels any in-progress speech whenever this
  // component unmounts, OR whenever the caller's stopSignal changes (panel
  // close, new chat, logout, and "the message changed" are all just
  // different reasons SiaPanel.js changes that value).
  useEffect(() => {
    return () => {
      if (available) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal]);

  // Component unmount specifically (e.g. this very message being removed
  // from the transcript) -- kept as its own effect with an empty
  // dependency array so it fires exactly once, on unmount, regardless of
  // how many times stopSignal changed during this component's lifetime.
  useEffect(() => {
    return () => {
      if (available) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!available) return null;
  if (typeof text !== "string" || text.trim() === "") return null;

  const handleListen = () => {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  return (
    <button
      type="button"
      className="sia-secondary-btn sia-speak-btn"
      onClick={isSpeaking ? handleStop : handleListen}
      aria-label={isSpeaking ? "Stop reading" : "Listen to answer"}
    >
      {isSpeaking ? "Stop" : "Listen"}
    </button>
  );
};

export default SiaSpeakButton;

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

function cleanInlineMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^\s)]+(?:\s+[^)]*)?\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map(cleanInlineMarkdown);
}

function isTableSeparator(line, columnCount) {
  const cells = parseTableRow(line);
  return cells.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

// Browser speech synthesis reads Markdown table separators literally. Keep
// the displayed answer untouched, but turn each table row into labelled
// speech so values retain their column meaning without speaking "dash".
export function toSpeechText(text) {
  if (typeof text !== "string") return "";

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const spokenLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headers = parseTableRow(lines[index]);
    if (lines[index].includes("|") && isTableSeparator(lines[index + 1] || "", headers.length)) {
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        const cells = parseTableRow(lines[index]);
        if (cells.length !== headers.length) break;
        const row = cells
          .map((cell, cellIndex) => (cell ? `${headers[cellIndex]}: ${cell}` : ""))
          .filter(Boolean)
          .join(", ");
        if (row) spokenLines.push(row);
        index += 1;
      }
      index -= 1;
      continue;
    }

    const line = cleanInlineMarkdown(lines[index])
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "");
    if (line && !/^[-*_]{3,}$/.test(line)) spokenLines.push(line);
  }

  return spokenLines.join("\n");
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
    const utterance = new window.SpeechSynthesisUtterance(toSpeechText(text));
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

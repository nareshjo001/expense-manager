import React, { useEffect, useState } from "react";

// Workstream 3, part F -- an explicit, NEVER-autoplaying "Listen"/"Stop"
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
const SiaSpeakButton = ({ text, stopSignal }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const available = isSpeechSynthesisAvailable();

  // The single cleanup path: cancels any in-progress speech whenever this
  useEffect(() => {
    return () => {
      if (available) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal]);

  // Component unmount specifically (e.g. this very message being removed
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

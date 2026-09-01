import api from "./axios";

// POST /sia/transcriptions -- the sole SIA voice-input endpoint (see
export const transcribeSiaAudio = async ({ audioBlob, languageHint, signal } = {}) => {
  const formData = new FormData();
  formData.append("audio", audioBlob, "audio");
  if (typeof languageHint === "string" && languageHint.trim() !== "") {
    formData.append("languageHint", languageHint.trim());
  }

  const { data } = await api.post("/sia/transcriptions", formData, {
    signal,
    headers: {
      // Explicitly unset -- see the Content-Type contract note above.
      "Content-Type": undefined,
    },
    transformRequest: (body, headers) => {
      // CRA/axios's default transformRequest would otherwise leave the
      if (headers) {
        if (typeof headers.delete === "function") {
          headers.delete("Content-Type");
        } else {
          delete headers["Content-Type"];
          delete headers["content-type"];
        }
      }
      return body;
    },
  });
  return data;
};

export default transcribeSiaAudio;

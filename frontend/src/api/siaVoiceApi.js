import api from "./axios";

// POST /sia/transcriptions -- the sole SIA voice-input endpoint (see
// backend/Controllers/SiaControllers/transcribe.js). Sends the recorded
// audio as multipart/form-data under the single field name the backend's
// multer upload requires: "audio". `languageHint` is optional and only
// appended when supplied, mirroring siaApi.js's askSia's own
// omit-absent-fields convention.
//
// Content-Type contract: the shared axios instance (frontend/src/api/axios.js)
// sets a DEFAULT "Content-Type: application/json" header on every request.
// That default would otherwise stick on a FormData body and break the
// request -- multer needs the real "multipart/form-data; boundary=..."
// header the browser/axios generates FROM the FormData object itself, and
// that boundary can only be computed when Content-Type is left unset.
// Deleting the header here (rather than trying to override it with a
// string) is what lets axios/the browser compute and set the correct
// value with its boundary.
//
// `signal` is forwarded straight to axios so a caller (useSiaVoiceRecorder)
// can abort an in-flight transcription request via AbortController on
// cancel/unmount/navigation, exactly like this repo's existing query
// convention (see useSiaSessionsQuery/useSiaStatusQuery).
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
      // shared instance's static "application/json" default sitting on
      // this request; FormData must be handed to the underlying XHR/fetch
      // transport with NO explicit Content-Type so the browser can compute
      // the real multipart boundary from its actual parts. AxiosHeaders
      // (axios v1) requires its own `.delete()` method for a case-
      // insensitive removal; a plain object (older/mocked axios) is
      // deleted directly as a fallback.
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

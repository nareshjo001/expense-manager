import api from "./axios";

// DAT-004 -- thin wrapper over the data-export routes, through the shared
// axios instance (auth refresh / 401/429 handling stays centralized there,
// same convention as recurringApi.js/notificationPreferencesApi.js).
//
// POST /api/export answers EITHER with the raw exported file itself (200,
// small/"sync" export -- the browser should just download it) OR a 202 JSON
// envelope describing a queued/background export -- which one comes back
// isn't known ahead of time, so this always requests `responseType: "blob"`.
// A JSON body then also arrives as a Blob, so it's parsed back into a plain
// object below before being returned/thrown, meaning every caller (the
// mutation hook's success path, and error handling via error.response.data)
// still sees the same shapes every other API wrapper in this app hands
// back.
const CONTENT_DISPOSITION_FILENAME = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

const filenameFromContentDisposition = (headerValue) => {
  if (!headerValue) return null;
  const match = CONTENT_DISPOSITION_FILENAME.exec(headerValue);
  return match ? decodeURIComponent(match[1]) : null;
};

const blobToJson = async (blob) => JSON.parse(await blob.text());

export const createExport = async ({ domain, format, dateFrom, dateTo }) => {
  try {
    const response = await api.post(
      "/api/export",
      {
        domain,
        format,
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      },
      { responseType: "blob" }
    );

    // 202 -- queued/background export. The body is the same
    // { message, success, data } envelope every other endpoint in this app
    // uses, just delivered as a Blob because of responseType above.
    if (response.status === 202) {
      return await blobToJson(response.data);
    }

    // 200 -- the raw exported file. Handed back as-is (plus the filename
    // the server chose) so the caller can trigger a browser download;
    // this wrapper does not decide how that download happens.
    return {
      file: true,
      blob: response.data,
      contentType: response.headers["content-type"],
      filename: filenameFromContentDisposition(response.headers["content-disposition"]),
    };
  } catch (error) {
    // The shared axios instance's error handling (handleApiError) only
    // ever inspects error.response.status, never .data, so it already ran
    // fine before this catch even with an unparsed Blob body. But every
    // CALLER of this function expects error.response.data to be the
    // { message, success, errorCode } JSON body other API wrappers hand
    // back -- not a Blob -- so it's normalized here before rethrowing.
    if (error.response?.data instanceof Blob) {
      try {
        error.response.data = await blobToJson(error.response.data);
      } catch {
        // Not JSON (e.g. an HTML error page from an intermediary) -- leave
        // the Blob as-is rather than mask the original error.
      }
    }
    throw error;
  }
};

// DAT-004 -- the user's own past export requests (queued/processing/ready/
// failed/expired), newest presumably first per the server's own ordering.
export const listExportRequests = async (signal) => {
  const { data } = await api.get("/api/export", { signal });
  return data;
};

// Single in-flight request, for polling one specific export rather than
// refetching the whole list -- not currently used by
// useExportRequestsQuery (which polls the list endpoint directly, since the
// screen always shows the whole list anyway), but part of the agreed
// contract and kept here for a future caller that only cares about one id.
export const getExportRequestStatus = async (id, signal) => {
  const { data } = await api.get(`/api/export/${id}/status`, { signal });
  return data;
};

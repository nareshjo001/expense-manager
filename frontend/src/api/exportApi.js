import api from "./axios";

// DAT-004 -- thin wrapper over the data-export routes, through the shared
// axios instance (auth refresh / 401/429 handling stays centralized there,
// same convention as recurringApi.js/notificationPreferencesApi.js).
//
// POST /api/export answers EITHER with the raw exported file itself (200,
// small/"sync" export -- the browser should just download it) OR a 202 JSON
// envelope describing a queued/background export -- which one comes back
// isn't known ahead of time, so this always requests `responseType: "blob"`.
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

    if (response.status === 202) {
      return await blobToJson(response.data);
    }

    return {
      file: true,
      blob: response.data,
      contentType: response.headers["content-type"],
      filename: filenameFromContentDisposition(response.headers["content-disposition"]),
    };
  } catch (error) {
    if (error.response?.data instanceof Blob) {
      try {
        error.response.data = await blobToJson(error.response.data);
      } catch {
        // Not JSON
      }
    }
    throw error;
  }
};

// DAT-004 -- the user's own past export requests (queued/processing/ready/
// failed/expired), newest first per the server's own ordering.
export const listExportRequests = async (signal) => {
  const { data } = await api.get("/api/export", { signal });
  return data;
};

export const getExportRequestStatus = async (id, signal) => {
  const { data } = await api.get(`/api/export/${id}/status`, { signal });
  return data;
};

export const downloadExportFile = async (token) => {
  const response = await api.get(`/api/export/download/${token}`, {
    responseType: "blob",
  });
  return {
    blob: response.data,
    contentType: response.headers["content-type"],
    filename: filenameFromContentDisposition(response.headers["content-disposition"]),
  };
};

export const deleteExport = async (id) => {
  const { data } = await api.delete(`/api/export/${id}`);
  return data;
};

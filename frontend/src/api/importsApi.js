import api from "./axios";

// IMP-001 -- CSV bulk import: upload -> column mapping -> row-by-row
// preview -> commit. Same shared-axios-instance convention as
// receiptsApi.js/billApi.js -- auth attachment and centralized 401/429
// handling stay in axios.js, and every wrapper here just hands back
// `data` (the `{ success, message?, data?, errorCode? }` envelope) for
// the caller to unwrap, same as receiptsApi.js's wrappers.
//
// The two multipart calls below (headers preview + session creation)
// build a FormData with the file under the `file` field and leave
// Content-Type unset so axios/the browser generates the multipart
// boundary itself -- same convention billApi.js's uploadBill already
// documents and uses.

// Parses a just-selected CSV's header row (and a best-guess column
// mapping) without creating anything server-side yet -- the mapping step
// needs this before a session can be created.
export const getImportHeaders = async (file, signal) => {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post("/api/imports/headers", formData, { signal });
  return data;
};

// Creates the previewable import session from the ORIGINAL file plus the
// column mapping chosen on the mapping step. `columnMapping` is sent as a
// JSON string in its own form field (per the contract), not as nested
// FormData keys.
export const createImportSession = async (file, columnMapping, signal) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("columnMapping", JSON.stringify(columnMapping));

  const { data } = await api.post("/api/imports/sessions", formData, { signal });
  return data;
};

// Lightweight session history (no `rows`) -- newest first per the contract.
export const listImportSessions = async (signal) => {
  const { data } = await api.get("/api/imports/sessions", { signal });
  return data;
};

export const getImportSession = async (id, signal) => {
  const { data } = await api.get(`/api/imports/sessions/${id}`, { signal });
  return data;
};

// `decision` is "accept" | "skip". Response is the whole updated session,
// same "mutate one row, get the full parent back" shape as the receipt
// duplicate-decision endpoint.
export const decideImportRow = async (id, rowIndex, decision) => {
  const { data } = await api.patch(`/api/imports/sessions/${id}/rows/${rowIndex}`, { decision });
  return data;
};

export const commitImportSession = async (id) => {
  const { data } = await api.post(`/api/imports/sessions/${id}/commit`);
  return data;
};

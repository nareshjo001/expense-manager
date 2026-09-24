import api from "./axios";

// REC-003 -- thin wrapper over the recurring routes, through the shared axios
// instance so auth refresh and 401/429 handling are not reimplemented here.

// REC-003-T02 -- projected upcoming occurrences.
//
// `from`/`to` are optional to PASS but the response is bounded either way:
// omitting them yields the server's default window (~3 months), not
// everything. A window wider than the server's maximum is REFUSED with a
// WINDOW_TOO_LARGE error rather than silently truncated, so a caller cannot
// end up labelling three months of data as two years.
export const getUpcomingRecurring = async (signal, { from, to } = {}) => {
  const { data } = await api.get("/api/recurring/upcoming", {
    params: {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    signal,
  });
  return data;
};

// Existing desired-state toggle. Included here so the upcoming view has one
// place to import from; `isRecurring: false` ENDS a recurrence (it deletes
// the definition), it does not pause it -- there is no pause until REC-002.
export const setExpenseRecurring = async (expenseId, isRecurring) => {
  const { data } = await api.patch("/api/recurring", { expenseId, isRecurring });
  return data;
};

// REC-002-T02/T05 -- lifecycle management surface (list/detail/pause/resume/
// end/edit) over recurring definitions. Every mutation is compare-and-set:
// the caller must pass the definition's current `scheduleVersion` (from a
// prior list/detail read), and a stale one comes back as a 409 with
// errorCode SCHEDULE_VERSION_CONFLICT and the server's current definition in
// `data` -- callers refetch rather than blindly retry with the same version.

export const listRecurringDefinitions = async (signal) => {
  const { data } = await api.get("/api/recurring", { signal });
  return data;
};

export const getRecurringDefinition = async (id, signal) => {
  const { data } = await api.get(`/api/recurring/${id}`, { signal });
  return data;
};

export const pauseRecurringDefinition = async (id, scheduleVersion) => {
  const { data } = await api.patch(`/api/recurring/${id}/pause`, { scheduleVersion });
  return data;
};

export const resumeRecurringDefinition = async (id, scheduleVersion) => {
  const { data } = await api.patch(`/api/recurring/${id}/resume`, { scheduleVersion });
  return data;
};

export const endRecurringDefinition = async (id, scheduleVersion) => {
  const { data } = await api.patch(`/api/recurring/${id}/end`, { scheduleVersion });
  return data;
};

export const editRecurringDefinition = async (id, updates, scheduleVersion) => {
  const { data } = await api.patch(`/api/recurring/${id}`, { ...updates, scheduleVersion });
  return data;
};

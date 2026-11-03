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

// T02/T05 -- lifecycle management surface (list/detail/pause/resume/ end/edit) over recurring definitions.

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

export const skipRecurringOccurrence = async (id, date, scheduleVersion) => {
  const { data } = await api.patch(`/api/recurring/${id}/skip`, { date, scheduleVersion });
  return data;
};

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

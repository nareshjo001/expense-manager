"use strict";

// EXP-003 -- shared cursor-pagination helpers for user-owned, date-sorted
// lists.
//
// HISTORY (EXP-003-T03, 2026-09-09). These helpers were originally opt-in:
// a caller that omitted `limit` got the pre-existing unbounded query, so
// introducing pagination could not break a route that had not asked for it.
// That was the right call while pagination was being rolled out, but it left
// the feature's actual problem unsolved -- "several list endpoints return
// unbounded user histories" -- because the unbounded path stayed reachable
// from any client simply by omitting a parameter. A bound that callers may
// decline is not a bound.
//
// The list endpoints now apply DEFAULT_LIMIT when `limit` is absent, via
// resolveLimit() below. parseLimit() is kept unchanged for callers that
// genuinely need "absent means absent" and want to decide for themselves.
//
// NOTE the deliberate exception: fetchExpense/fetchExpenseRaw
// (Controllers/GetExpenseControllers/fetchExpenses.js) stay unbounded on
// purpose. Analytics, reports and charts call them for a whole date range and
// need every document in it -- a truncated page there would silently produce
// wrong totals, which is far worse than a large query. Bounding belongs on
// the HTTP list endpoints, not on the shared range primitive.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

class PaginationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaginationValidationError";
    this.statusCode = 400;
    this.code = "INVALID_PAGINATION_PARAMS";
  }
}

// Validates and normalizes `limit` from a raw query-string value. Absent
// stays absent (caller decides whether that means "use the default page
// size" or "fall back to the old unbounded path") -- only a PRESENT but
// invalid value is rejected.
function parseLimit(rawLimit, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
    return undefined;
  }
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
    throw new PaginationValidationError(`limit must be an integer between 1 and ${maxLimit}.`);
  }
  return parsed;
}

// EXP-003-T03 -- the bounded counterpart to parseLimit. An absent `limit`
// resolves to defaultLimit instead of undefined, so a list endpoint using
// this has no unbounded path at all. A PRESENT but invalid value is still
// rejected rather than silently replaced by the default: a client that asks
// for limit=99999 has made a mistake worth telling it about, and quietly
// serving 50 instead would hide the error and make the response size look
// like the client's own choice.
function resolveLimit(rawLimit, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const parsed = parseLimit(rawLimit, { defaultLimit, maxLimit });
  return parsed === undefined ? defaultLimit : parsed;
}

// A cursor is an opaque, base64url-encoded JSON pointer to the last item of
// the previous page: { d: <ISO date string>, i: <Mongo _id string> }. Never
// a raw skip/offset (offsets drift under concurrent inserts/deletes -- a
// cursor stays stable because it anchors to a specific, unique document).
function encodeCursor({ date, id }) {
  const payload = JSON.stringify({ d: new Date(date).toISOString(), i: String(id) });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(rawCursor) {
  if (rawCursor === undefined || rawCursor === null || rawCursor === "") {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(rawCursor), "base64url").toString("utf8"));
  } catch {
    throw new PaginationValidationError("cursor is malformed.");
  }
  const date = new Date(parsed && parsed.d);
  const id = parsed && parsed.i;
  if (isNaN(date.getTime()) || typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
    throw new PaginationValidationError("cursor is malformed.");
  }
  return { date, id };
}

// Builds the Mongo filter fragment that selects only documents strictly
// AFTER the cursor in a (dateField DESC, _id DESC) sort order -- the
// standard two-column keyset-pagination predicate, so paging never skips
// or repeats a document even if new ones are inserted between page reads.
function buildCursorFilter(cursor, dateField) {
  if (!cursor) return {};
  return {
    $or: [
      { [dateField]: { $lt: cursor.date } },
      { [dateField]: cursor.date, _id: { $lt: cursor.id } },
    ],
  };
}

// Given one extra-fetched "probe" document beyond the page size, splits the
// result set into the page to return plus whether more pages remain, and
// derives the next cursor from the true last item of the returned page.
function paginateResults(documents, limit, dateField) {
  const hasMore = documents.length > limit;
  const page = hasMore ? documents.slice(0, limit) : documents;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ date: last[dateField], id: last._id }) : null;
  return { page, hasMore, nextCursor };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PaginationValidationError,
  parseLimit,
  resolveLimit,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  paginateResults,
};

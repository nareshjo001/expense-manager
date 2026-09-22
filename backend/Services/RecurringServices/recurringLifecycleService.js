"use strict";

// REC-002-T02/T03/T04 -- the lifecycle mutation service for recurring
// definitions: list/detail (read-only) and pause/resume/end/edit (mutating,
// all compare-and-set).
//
// Every mutation here changes ONLY the RecurringExpenseModel document --
// never an ExpenseModel document (REC-002-T03: "separate schedule changes
// from historical expenses"). cron/recurringJob.js reads a definition's own
// copied expenseName/expenseCategory/expenseAmount fields when it creates
// each occurrence's Expense document, not the original triggering expense,
// so editing a definition here changes FUTURE occurrences without rewriting
// anything already logged. See recurringJob.js and
// Controllers/RecurringExpenses/README-ish comment in UpcomingRecurring.js
// for the fuller trace of why that separation was already true by
// construction, once an edit path onto the definition itself existed (it
// didn't, before this).
//
// CAS (REC-002-T04): every mutation requires the caller's last-known
// `scheduleVersion` and is applied via a single atomic
// `findOneAndUpdate({_id, userId, status: <required current state(s)>,
// scheduleVersion: <caller's value>}, {$set: ..., $inc: {scheduleVersion:
// 1}})`. A null result is ambiguous between "not found/not owned",
// "version conflict" (someone else mutated it first) and "invalid state
// transition" (e.g. pausing an already-paused definition) -- this service
// disambiguates with one extra read (see `resolveMutationFailure` below),
// same tradeoff cron/recurringJob.js's own CAS update already accepts for
// its nextDueDate advancement.
const { RecurringExpenseModel } = require("../../models/RecurringExpense");
const { normalizeCategory } = require("../../utils/categoryNormalization");
const { withMinorFields } = require("../../utils/moneyView");

const MONEY_FIELDS = ["expenseAmount"];

// Field selection for every response this service returns. Deliberately
// excludes nothing sensitive -- a recurring definition carries no data more
// sensitive than an expense itself, and the client needs scheduleVersion for
// its next mutation.
function toPublicShape(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const shaped = {
    id: String(plain._id),
    expenseId: plain.expenseId ? String(plain.expenseId) : null,
    expenseName: plain.expenseName,
    expenseCategory: plain.expenseCategory,
    expenseAmount: plain.expenseAmount,
    status: plain.status,
    recurrenceFrequency: plain.recurrenceFrequency,
    lastLoggedDate: plain.lastLoggedDate,
    nextDueDate: plain.nextDueDate,
    pausedAt: plain.pausedAt ?? null,
    resumedAt: plain.resumedAt ?? null,
    endedAt: plain.endedAt ?? null,
    endDate: plain.endDate ?? null,
    scheduleVersion: plain.scheduleVersion,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
  return withMinorFields(shaped, MONEY_FIELDS);
}

async function listDefinitions(userId) {
  const docs = await RecurringExpenseModel.find({ userId }).sort({ nextDueDate: 1 }).lean();
  return docs.map(toPublicShape);
}

async function getDefinition(userId, id) {
  const doc = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  return toPublicShape(doc);
}

// Disambiguates a failed (null-returning) CAS update. Runs AFTER the failed
// attempt, never before -- checking first and mutating second would reopen
// exactly the race the atomic update exists to close.
async function resolveMutationFailure(userId, id) {
  const current = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  if (!current) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: false, reason: "version_conflict", current: toPublicShape(current) };
}

async function pauseDefinition(userId, id, scheduleVersion) {
  const existing = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "ended") return { ok: false, reason: "already_ended" };
  if (existing.status === "paused") return { ok: false, reason: "already_paused" };

  const updated = await RecurringExpenseModel.findOneAndUpdate(
    { _id: id, userId, status: "active", scheduleVersion },
    { $set: { status: "paused", pausedAt: new Date() }, $inc: { scheduleVersion: 1 } },
    { new: true }
  ).lean();

  if (!updated) return resolveMutationFailure(userId, id);
  return { ok: true, definition: toPublicShape(updated) };
}

async function resumeDefinition(userId, id, scheduleVersion) {
  const existing = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "ended") return { ok: false, reason: "already_ended" };
  if (existing.status === "active") return { ok: false, reason: "already_active" };

  const updated = await RecurringExpenseModel.findOneAndUpdate(
    { _id: id, userId, status: "paused", scheduleVersion },
    { $set: { status: "active", resumedAt: new Date() }, $inc: { scheduleVersion: 1 } },
    { new: true }
  ).lean();

  if (!updated) return resolveMutationFailure(userId, id);
  return { ok: true, definition: toPublicShape(updated) };
}

async function endDefinition(userId, id, scheduleVersion) {
  const existing = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "ended") return { ok: false, reason: "already_ended" };

  const updated = await RecurringExpenseModel.findOneAndUpdate(
    { _id: id, userId, status: { $in: ["active", "paused"] }, scheduleVersion },
    { $set: { status: "ended", endedAt: new Date() }, $inc: { scheduleVersion: 1 } },
    { new: true }
  ).lean();

  if (!updated) return resolveMutationFailure(userId, id);
  return { ok: true, definition: toPublicShape(updated) };
}

const EDITABLE_FIELDS = ["expenseName", "expenseCategory", "expenseAmount", "nextDueDate", "endDate"];

function normalizeExpenseAmount(rawValue) {
  if (typeof rawValue !== "number" && typeof rawValue !== "string") return null;
  if (typeof rawValue === "string" && rawValue.trim() === "") return null;
  const normalized = Number(rawValue);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

function normalizeDate(rawValue) {
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return undefined; // signals "invalid", distinct from "not provided"
  return parsed;
}

// Validates and normalizes the caller-supplied edit payload. Returns
// { ok: true, updates } or { ok: false, reason, field }. Only fields
// actually present in `body` are validated/applied -- an edit is a partial
// patch, matching editExpense.js's own EDITABLE_FIELDS convention.
function buildEditUpdates(body) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "expenseName")) {
    const name = typeof body.expenseName === "string" ? body.expenseName.trim() : "";
    if (!name) return { ok: false, reason: "invalid_name" };
    updates.expenseName = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "expenseCategory")) {
    const normalizedCategory = normalizeCategory(body.expenseCategory);
    if (normalizedCategory === null) return { ok: false, reason: "invalid_category" };
    updates.expenseCategory = normalizedCategory;
  }

  if (Object.prototype.hasOwnProperty.call(body, "expenseAmount")) {
    const normalizedAmount = normalizeExpenseAmount(body.expenseAmount);
    if (normalizedAmount === null) return { ok: false, reason: "invalid_amount" };
    updates.expenseAmount = normalizedAmount;
  }

  if (Object.prototype.hasOwnProperty.call(body, "nextDueDate")) {
    const normalizedDate = normalizeDate(body.nextDueDate);
    if (normalizedDate === undefined) return { ok: false, reason: "invalid_next_due_date" };
    if (normalizedDate.getTime() < Date.now()) {
      // The job only ever advances forward (see recurringJob.js) -- a next
      // run in the past could never actually be honored by it, so this is
      // refused rather than silently accepted and never fired.
      return { ok: false, reason: "next_due_date_in_past" };
    }
    updates.nextDueDate = normalizedDate;
  }

  if (Object.prototype.hasOwnProperty.call(body, "endDate")) {
    if (body.endDate === null) {
      updates.endDate = null; // explicit clear -- un-schedules a previously set end.
    } else {
      const normalizedDate = normalizeDate(body.endDate);
      if (normalizedDate === undefined) return { ok: false, reason: "invalid_end_date" };
      updates.endDate = normalizedDate;
    }
  }

  return { ok: true, updates };
}

async function editDefinition(userId, id, body, scheduleVersion) {
  const existing = await RecurringExpenseModel.findOne({ _id: id, userId }).lean();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "ended") return { ok: false, reason: "already_ended" };

  const providedFields = EDITABLE_FIELDS.filter((f) =>
    Object.prototype.hasOwnProperty.call(body, f)
  );
  if (providedFields.length === 0) {
    return { ok: false, reason: "no_fields_provided" };
  }

  const validation = buildEditUpdates(body);
  if (!validation.ok) return validation;

  const updated = await RecurringExpenseModel.findOneAndUpdate(
    { _id: id, userId, status: { $ne: "ended" }, scheduleVersion },
    { $set: validation.updates, $inc: { scheduleVersion: 1 } },
    { new: true }
  ).lean();

  if (!updated) return resolveMutationFailure(userId, id);
  return { ok: true, definition: toPublicShape(updated) };
}

module.exports = {
  listDefinitions,
  getDefinition,
  pauseDefinition,
  resumeDefinition,
  endDefinition,
  editDefinition,
  toPublicShape,
  buildEditUpdates,
};

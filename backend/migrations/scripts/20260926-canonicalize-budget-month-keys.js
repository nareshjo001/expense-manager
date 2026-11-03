"use strict";

// Js). Why this exists: DAT-002-T05 shipped the month-key check as report-only.
const { parseMonthKey, buildMonthKeyFromParts } = require("../../utils/monthKeyNormalization");

const COLLECTION = "budgets";
const MAX_EXAMPLES = 20;

const MONTH_NAMES = [
  ["jan", "january"], ["feb", "february"], ["mar", "march"], ["apr", "april"],
  ["may"], ["jun", "june"], ["jul", "july"], ["aug", "august"],
  ["sep", "sept", "september"], ["oct", "october"], ["nov", "november"], ["dec", "december"],
];

// Lenient parse of a stored key into its canonical form, or null.
function canonicalizeMonthKey(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const monthIndex = MONTH_NAMES.findIndex((names) => names.includes(word));
  if (monthIndex === -1) return null;
  return buildMonthKeyFromParts(Number(match[2]), monthIndex + 1);
}

// Compares the user-entered amount, preferring the integer minor-units field
// (DAT-001) when both documents have it, so float noise cannot matter.
function sameBudgetAmount(a, b) {
  if (Number.isInteger(a.budgetMinor) && Number.isInteger(b.budgetMinor)) return a.budgetMinor === b.budgetMinor;
  return typeof a.budget === "number" && a.budget === b.budget;
}

async function plan(db) {
  const coll = db.collection(COLLECTION);
  const renames = [];
  const conflicts = [];
  const duplicates = [];
  const unparseable = [];
  let scanned = 0;

  for await (const doc of coll.find({}, { projection: { userId: 1, month: 1, budget: 1, budgetMinor: 1 } })) {
    scanned += 1;
    if (parseMonthKey(doc.month) !== null && doc.month.trim() === doc.month) continue; // already canonical
    const canonical = canonicalizeMonthKey(doc.month);
    if (!canonical) {
      unparseable.push({ docId: String(doc._id), month: String(doc.month) });
      continue;
    }
    const existing = await coll.findOne(
      { userId: doc.userId, month: canonical },
      { projection: { _id: 1, budget: 1, budgetMinor: 1 } }
    );
    if (existing && String(existing._id) !== String(doc._id)) {
      if (sameBudgetAmount(doc, existing)) {
        duplicates.push({ _id: doc._id, docId: String(doc._id), keptDocId: String(existing._id), month: doc.month, budget: doc.budget });
      } else {
        conflicts.push({ docId: String(doc._id), conflictsWith: String(existing._id), from: doc.month, to: canonical });
      }
    } else {
      renames.push({ _id: doc._id, docId: String(doc._id), from: doc.month, to: canonical });
    }
  }
  return { scanned, renames, duplicates, conflicts, unparseable };
}

module.exports = {
  id: "20260926-canonicalize-budget-month-keys",
  description:
    'Rewrite non-canonical Budget.month keys (e.g. "Sept 2026") to the canonical "MMM YYYY" form DAT-002 reads and writes; conflicts and unparseable keys are reported, never guessed.',
  canonicalizeMonthKey,

  async up({ mongoose, logger, dryRun }) {
    const db = mongoose.connection.db;
    const { scanned, renames, duplicates, conflicts, unparseable } = await plan(db);

    for (const d of duplicates) {
      if (dryRun) {
        logger.info({ event: "would_delete_duplicate_month", docId: d.docId, keptDocId: d.keptDocId, month: d.month });
        continue;
      }
      // Guarded on month AND amount, so a document changed since plan() is
      // left alone (and then fails verify) rather than deleted.
      await db.collection(COLLECTION).deleteOne({ _id: d._id, month: d.month, budget: d.budget });
      logger.info({ event: "duplicate_month_deleted", docId: d.docId, keptDocId: d.keptDocId, month: d.month });
    }

    for (const r of renames) {
      if (dryRun) {
        logger.info({ event: "would_rename_month", docId: r.docId, from: r.from, to: r.to });
        continue;
      }
      // Guarded on the old value so a concurrent change is never overwritten.
      await db.collection(COLLECTION).updateOne({ _id: r._id, month: r.from }, { $set: { month: r.to } });
      logger.info({ event: "month_renamed", docId: r.docId, from: r.from, to: r.to });
    }

    logger.info({
      event: "budget_month_canonicalization",
      scanned,
      renamed: renames.length,
      duplicatesDeleted: duplicates.length,
      conflicts: conflicts.length,
      unparseable: unparseable.length,
      conflictExamples: conflicts.slice(0, MAX_EXAMPLES),
      unparseableExamples: unparseable.slice(0, MAX_EXAMPLES),
    });
    return { scanned, renamed: renames.length, duplicatesDeleted: duplicates.length, conflicts, unparseable };
  },

  async verify({ mongoose, logger }) {
    const { scanned, renames, duplicates, conflicts, unparseable } = await plan(mongoose.connection.db);
    const remaining = renames.length + duplicates.length + conflicts.length + unparseable.length;
    if (remaining > 0) {
      throw new Error(
        `${remaining} budget month key(s) are still non-canonical (${renames.length} renameable, ${duplicates.length} duplicate, ` +
          `${conflicts.length} conflicting with an existing canonical document, ${unparseable.length} unparseable). ` +
          "Conflicts need a decision on which budget to keep; see the budget_month_canonicalization log line."
      );
    }
    logger.info({ event: "verify_ok", scanned });
  },
};

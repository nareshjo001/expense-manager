"use strict";

// Js's parseMonthKey). This migration never writes anything -- up() and verify() both only scan and log.
const { parseMonthKey } = require("../../utils/monthKeyNormalization");

const PROGRESS_LOG_EVERY = 500;
const MAX_EXAMPLES = 20;

function normalizeEmailValue(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

async function scanEmailGaps({ db, logger }) {
  const coll = db.collection("users");
  const cursor = coll.find({}, { projection: { email: 1 } });

  const byNormalized = new Map(); // normalized email -> [{ docId, email }]
  let scanned = 0;
  let nonCanonicalCount = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const raw = doc.email;
    const normalized = normalizeEmailValue(raw);

    if (typeof raw === "string" && raw !== normalized) {
      nonCanonicalCount += 1;
    }

    if (typeof normalized === "string") {
      if (!byNormalized.has(normalized)) byNormalized.set(normalized, []);
      byNormalized.get(normalized).push({ docId: String(doc._id), email: raw });
    }

    if (scanned % PROGRESS_LOG_EVERY === 0) {
      logger.info({ event: "email_scan_progress", scanned });
    }
  }

  const collisions = [];
  for (const [normalized, docs] of byNormalized) {
    if (docs.length > 1) {
      collisions.push({ normalized, docs });
    }
  }

  logger.info({
    event: "email_backfill_and_collision_report",
    scanned,
    nonCanonicalCount,
    collisionGroupCount: collisions.length,
  });
  collisions.forEach((collision) => {
    // Document ids only -- never the email addresses themselves (OBS-001-T01
    // redaction). An operator resolves a collision by looking the ids up.
    logger.warn({ event: "email_collision", docIds: collision.docs.map((d) => d.docId), docCount: collision.docs.length });
  });

  return { scanned, nonCanonicalCount, collisions };
}

async function scanBudgetMonthGaps({ db, logger }) {
  // Js; confirmed directly against the actual mongoose package, not assumed).
  const coll = db.collection("budgets");
  const cursor = coll.find({}, { projection: { month: 1, userId: 1 } });

  let scanned = 0;
  let malformedCount = 0;
  const examples = [];

  for await (const doc of cursor) {
    scanned += 1;
    const parsed = parseMonthKey(doc.month);
    if (!parsed) {
      malformedCount += 1;
      if (examples.length < MAX_EXAMPLES) {
        examples.push({ docId: String(doc._id), month: doc.month });
      }
    }

    if (scanned % PROGRESS_LOG_EVERY === 0) {
      logger.info({ event: "budget_month_scan_progress", scanned });
    }
  }

  logger.info({
    event: "budget_month_backfill_report",
    scanned,
    malformedCount,
    examples,
  });

  return { scanned, malformedCount, examples };
}

module.exports = {
  // Email` instead of redefining it a second time.
  scanEmailGaps,
  scanBudgetMonthGaps,

  id: "20260921-report-email-and-month-normalization-gaps",
  description:
    "Read-only report: counts User.email documents not yet in canonical lowercase/trimmed form and any collisions normalizing them would cause, plus Budget.month documents that don't parse as the canonical MMM YYYY key. Never writes -- resolving what it finds (backfilling email, fixing malformed months) is a separate, manual follow-up, not this migration's job.",

  async up({ mongoose, logger }) {
    const db = mongoose.connection.db;
    const email = await scanEmailGaps({ db, logger });
    const budgetMonth = await scanBudgetMonthGaps({ db, logger });
    return { email, budgetMonth };
  },

  async verify({ mongoose, logger }) {
    // This migration never writes, so there is no prior mutation to check for completeness the way other migrations' verify() does.
    const db = mongoose.connection.db;
    const email = await scanEmailGaps({ db, logger });
    const budgetMonth = await scanBudgetMonthGaps({ db, logger });
    logger.info({
      event: "verify_ok",
      emailScanned: email.scanned,
      budgetMonthScanned: budgetMonth.scanned,
    });
  },
};

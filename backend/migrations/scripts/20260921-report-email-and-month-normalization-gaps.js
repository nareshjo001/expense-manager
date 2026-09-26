"use strict";

// DAT-002-T05 -- read-only reconnaissance for the two data-quality gaps
// DAT-002-T02 deliberately left unbackfilled (see that task's "Stated
// limitation" in workflow/features/P1/DAT-002-database-schema-quality-
// and-integrity.md): a User.email document written before T02's schema-
// level `lowercase: true, trim: true` setter may still be stored in a
// non-canonical case/whitespace form, and a Budget.month document written
// before T02's validator may not parse as the canonical "MMM YYYY" key
// (utils/monthKeyNormalization.js's parseMonthKey).
//
// This migration never writes anything -- up() and verify() both only
// scan and log. That is deliberate, not a placeholder for a future
// mutating pass: users.email has a `unique: true` index on the *raw
// stored string* (config/Schemas.js), so two existing documents whose
// values only differ by case/whitespace ("Foo@x.com" and "foo@x.com ")
// can coexist today but would collide the instant anything tried to
// rewrite them to the same normalized value. Actually normalizing
// existing rows is only safe once this report has been read and any
// reported collisions have been manually resolved (merge/delete/rename
// one of the colliding accounts) -- that resolution is a product/data
// decision this migration does not make for anyone. budgets/budget has
// no comparable collision risk: it already has a `unique: true` compound
// index on { userId, month } (config/Schemas.js), and DAT-002-T02
// confirmed "MMM YYYY" is the real persisted format everywhere in this
// codebase, not a format this migration is changing -- so its malformed-
// value list below is a plain backfill-candidate list, not a collision
// report.
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
    logger.warn({ event: "email_collision", normalized: collision.normalized, docs: collision.docs });
  });

  return { scanned, nonCanonicalCount, collisions };
}

async function scanBudgetMonthGaps({ db, logger }) {
  // DAT-002-T06 correction -- the real collection is "budgets" (Mongoose
  // pluralizes the "budget" model name registered in config/Schemas.js;
  // confirmed directly against the actual mongoose package, not assumed).
  // "budget" (singular) would silently match nothing against a real
  // connection -- caught while investigating T06's orphan checks, fixed
  // here before this script was ever run for real.
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
  // DAT-002-T06 -- exported (alongside the migration shape below) so the
  // orphan/duplicate integrity-check migration can reuse this exact
  // collision-detection logic for `users.email` instead of redefining it
  // a second time.
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
    // This migration never writes, so there is no prior mutation to
    // check for completeness the way other migrations' verify() does.
    // "Verify" here means: re-running the same read-only scan completes
    // without throwing and reports the same shape of result -- unlike a
    // mutating migration, running this one twice must be safe and must
    // produce identical counts, since nothing it does changes the data
    // it's reading.
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

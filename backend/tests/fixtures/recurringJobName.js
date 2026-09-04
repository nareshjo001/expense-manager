// TST-001-T06 -- reads the real job-lease name straight out of
// cron/recurringJob.js's own source, instead of hardcoding a second copy
// of the "recurringJob" literal here that could silently drift out of
// sync if that module ever renames its JOB_NAME constant. Used only by
// the "acquire-and-crash" worker mode, which must squat on the EXACT same
// Redis key the real job uses in order to simulate a crashed instance
// blocking a second, genuinely separate instance from picking up the job.
"use strict";

const fs = require("fs");
const path = require("path");

function getRealRecurringJobName() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "cron", "recurringJob.js"),
    "utf8"
  );
  const match = /const\s+JOB_NAME\s*=\s*["']([^"']+)["']/.exec(source);
  if (!match) {
    throw new Error(
      "recurringJobName: could not find `const JOB_NAME = \"...\"` in cron/recurringJob.js -- update the regex if that module's shape changed."
    );
  }
  return match[1];
}

module.exports = { getRealRecurringJobName };

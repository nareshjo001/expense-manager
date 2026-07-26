const reportCache = require('../cache/reportCache');
const { generateReport } = require("../analytics/reportGenerator");
const FinancialReport = require("../models/Report");

const getReport = async (userId) => {
  const cached = await reportCache.get(userId);

  if (cached) {
    console.log("Redis HIT");
    return cached;
  }

  console.log("Redis MISS");

  let report = await FinancialReport.findOne({ user: userId }).lean();

  if (report) {
    await reportCache.set(userId, report);
    return report;
  }

  const generatedReport = await generateReport(userId);

  // Atomic find-or-create: FinancialReport.user has a unique index, so two
  // concurrent first-time requests can both reach this point after both
  // observing "not found" above. A plain create() would let one succeed and
  // the other throw a duplicate-key error. upsert:true makes this a single
  // atomic operation — whichever request's write lands first inserts the
  // document, and the other's upsert simply updates that same document with
  // its own freshly generated report instead of failing.
  const savedReport = await FinancialReport.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      ...generatedReport,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  await reportCache.set(userId, generatedReport);

  return savedReport;
};

const refreshReport = async (userId) => {
  const generatedReport = await generateReport(userId);

  const updatedReport = await FinancialReport.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      ...generatedReport,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  await reportCache.set(userId, generatedReport);
  
  return updatedReport;
};

module.exports = {
  getReport,
  refreshReport,
};
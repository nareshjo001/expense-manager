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

  const savedReport = await FinancialReport.create({
    user: userId,
    ...generatedReport,
  });

  await reportCache.set(userId, generatedReport);

  return savedReport.toObject();
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
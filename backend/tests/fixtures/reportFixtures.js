// Fixture builders and a scoped-cleanup artifact tracker for the M0-2
// integration suite. Test-only -- never required by production code.
"use strict";

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { ExpenseModel, BudgetModel } = require("../../config/Schemas");
const FinancialReport = require("../../models/Report");
const { CURRENT_REPORT_VERSION } = require("../../analytics/reportContractVersion");

function freshUserId() {
  return new mongoose.Types.ObjectId();
}

// Mirrors Controllers/AuthControllers/login.js's JWT payload shape exactly
function signTestToken(userId, email) {
  return jwt.sign({ email, _id: userId }, process.env.JWT_SECRET);
}

// Matches budgetAnalyzer.js's own month-key derivation exactly
function currentMonthKey() {
  const now = new Date();
  return `${now.toLocaleString("en-US", { month: "short" })} ${now.getFullYear()}`;
}

function currentMonthDate(dayOfMonth = 10) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
}

// Matches dataProvider.js's getPreviousMonthExpenses range exactly
function previousMonthDate(dayOfMonth = 10) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, dayOfMonth);
}

// A structurally plausible cached report matching the shape reportAssembler.js
function buildFakeCachedReport(marker) {
  return {
    metadata: {
      // Reuses the same shared current-version constant reportService.js's
      version: CURRENT_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      reportPeriod: { month: new Date().getMonth() + 1, year: new Date().getFullYear() },
      lastExpenseUpdate: null,
      lastBudgetUpdate: null,
    },
    summary: {
      totalSpent: marker,
      transactionCount: 0,
      dailyAverage: 0,
      comparePastMonth: 0,
      topCategory: "M0-2-FAKE-CACHE-MARKER",
      budgetUtilization: null,
      budgetStatus: "NoBudgetSet",
    },
    spending: {},
    budgets: {},
    categories: { monthly: { hasData: false }, yearly: { hasData: false } },
    trends: {},
    habits: { monthly: { hasData: false }, yearly: { hasData: false } },
    financialHealth: { scores: {}, overall: null, dataCompleteness: {}, risk: { label: "Unknown", color: "gray" }, signals: [] },
    forecast: { hasData: false },
    anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
  };
}

// Tracks exactly what one test creates, so cleanup and its verification
class ArtifactTracker {
  constructor() {
    this.expenseIds = [];
    this.budgetIds = [];
    this.reportUserIds = [];
    this.redisKeys = [];
  }

  async createExpense(userId, overrides = {}) {
    const doc = await ExpenseModel.create({
      userId,
      id: overrides.id || `m0-2-fx-${new mongoose.Types.ObjectId()}`,
      expenseName: overrides.expenseName || "M0-2 Fixture Expense",
      expenseCategory: overrides.expenseCategory || "M0-2-Fixture-Category",
      expenseAmount: overrides.expenseAmount ?? 100,
      expenseDate: overrides.expenseDate || currentMonthDate(),
    });
    this.expenseIds.push(doc._id);
    return doc;
  }

  async createBudget(userId, overrides = {}) {
    const doc = await BudgetModel.create({
      userId,
      month: overrides.month || currentMonthKey(),
      budget: overrides.budget ?? 10000,
      spent: overrides.spent ?? 0,
    });
    this.budgetIds.push(doc._id);
    return doc;
  }

  // Tracks a userId whose FinancialReport document (if any gets persisted
  trackReportUser(userId) {
    this.reportUserIds.push(userId);
  }

  trackRedisKey(key, redisClient) {
    this.redisKeys.push({ key, redisClient });
  }

  async cleanup() {
    if (this.expenseIds.length) {
      await ExpenseModel.deleteMany({ _id: { $in: this.expenseIds } });
    }
    if (this.budgetIds.length) {
      await BudgetModel.deleteMany({ _id: { $in: this.budgetIds } });
    }
    if (this.reportUserIds.length) {
      await FinancialReport.deleteMany({ user: { $in: this.reportUserIds } });
    }
    for (const { key, redisClient } of this.redisKeys) {
      await redisClient.del(key);
    }
  }

  // Re-queries every tracked id/key by its exact identity (never a scan,
  async verifyAbsent() {
    const remainingExpenses = this.expenseIds.length
      ? await ExpenseModel.countDocuments({ _id: { $in: this.expenseIds } })
      : 0;
    const remainingBudgets = this.budgetIds.length
      ? await BudgetModel.countDocuments({ _id: { $in: this.budgetIds } })
      : 0;
    const remainingReports = this.reportUserIds.length
      ? await FinancialReport.countDocuments({ user: { $in: this.reportUserIds } })
      : 0;

    let remainingKeys = 0;
    for (const { key, redisClient } of this.redisKeys) {
      remainingKeys += await redisClient.exists(key);
    }

    return {
      clean:
        remainingExpenses === 0 &&
        remainingBudgets === 0 &&
        remainingReports === 0 &&
        remainingKeys === 0,
      remainingExpenses,
      remainingBudgets,
      remainingReports,
      remainingKeys,
    };
  }
}

module.exports = {
  freshUserId,
  signTestToken,
  currentMonthKey,
  currentMonthDate,
  previousMonthDate,
  buildFakeCachedReport,
  ArtifactTracker,
};

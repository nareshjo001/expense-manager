const { UserModel, ExpenseModel, MlFeedbackModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');
const { normalizeCategory } = require('../../utils/categoryNormalization');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');
const axios = require("axios");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
const { buildMlServiceUrl, mlOperationsHeaders } = require('../../utils/mlServiceClient');

// Category Normalization -- controlled 400 for an invalid/missing category,
const INVALID_CATEGORY_RESPONSE = {
  success: false,
  message: 'Expense category is required and must be a valid, non-empty value.',
  errorCode: 'INVALID_CATEGORY',
};

// Hotfix -- production ValidationError: `wasMlCorrected: Cast to Boolean
const normalizeOptionalBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: undefined };
  }
  if (value === true || value === 'true') {
    return { valid: true, value: true };
  }
  if (value === false || value === 'false') {
    return { valid: true, value: false };
  }
  return { valid: false };
};

const INVALID_WAS_ML_CORRECTED_RESPONSE = {
  success: false,
  message: 'wasMlCorrected must be a boolean value.',
  errorCode: 'INVALID_WAS_ML_CORRECTED',
};

// Phase C -- Expense Mutation Reliability: add-expense idempotency.
const isSameExpensePayload = (stored, incoming) => {
  if (!stored) return false;

  const nameMatches =
    String(stored.expenseName ?? '').trim() === String(incoming.expenseName ?? '').trim();
  const storedCategory = normalizeCategory(stored.expenseCategory);
  const incomingCategory = normalizeCategory(incoming.expenseCategory);
  const categoryMatches = storedCategory !== null && storedCategory === incomingCategory;
  const amountMatches = Number(stored.expenseAmount) === Number(incoming.expenseAmount);

  const storedDate = new Date(stored.expenseDate);
  const incomingDate = new Date(incoming.expenseDate);
  const dateMatches =
    !Number.isNaN(storedDate.getTime()) &&
    !Number.isNaN(incomingDate.getTime()) &&
    storedDate.getTime() === incomingDate.getTime();

  return nameMatches && categoryMatches && amountMatches && dateMatches;
};

const IDEMPOTENCY_CONFLICT_RESPONSE = {
  success: false,
  message: 'A different expense was already submitted with this request identifier.',
  errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
};

// Builds the replay success response: the identical 2xx contract a first
const buildReplayResponse = async (userId, existingExpense) => {
  const derivedData = await synchronizeAfterMutation({
    userId,
    budgetDates: [existingExpense.expenseDate],
  });

  // A replayed add can return an expense that was marked recurring since
  const annotatedExpense = await annotateRecurringState(userId, existingExpense);

  return {
    message: 'Expense Created Successfully',
    success: true,
    data: annotatedExpense,
    derivedData,
    replayed: true,
  };
};

// Server-derived source of truth for whether a genuine ML correction occurred.
const deriveMlCorrection = (mlPredictedCategory, normalizedExpenseCategory) => {
  const predicted = normalizeCategory(mlPredictedCategory);

  if (!predicted) {
    return { hasPrediction: false, corrected: false };
  }

  return { hasPrediction: true, corrected: predicted !== normalizedExpenseCategory };
};

const addExpense = async (req, res) => {
  // Phase C.2 -- declared outside the try block so the catch below can
  let ownerUserId = null;
  let budgetReservations = [];
  let reportReservation = null;
  let primaryWriteCommitted = false;
  let writeStatus = "not-dispatched";

  try {
    // Destructure expense data from request body
    const { id, expenseName, expenseCategory, expenseAmount, expenseDate, expenseDescription, mlPredictedCategory, mlConfidence, wasMlCorrected } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }
    ownerUserId = user._id;

    // Category Normalization -- validated and canonicalized BEFORE the
    const normalizedCategory = normalizeCategory(expenseCategory);
    if (normalizedCategory === null) {
      return res.status(400).json(INVALID_CATEGORY_RESPONSE);
    }

    // Hotfix -- normalize the optional `wasMlCorrected` boolean at the
    const wasMlCorrectedResult = normalizeOptionalBoolean(wasMlCorrected);
    if (!wasMlCorrectedResult.valid) {
      return res.status(400).json(INVALID_WAS_ML_CORRECTED_RESPONSE);
    }
    const normalizedWasMlCorrected = wasMlCorrectedResult.value;

    // Idempotency check -- BEFORE any write. Ownership-scoped: the lookup
    const existingById = await ExpenseModel.findOne({ userId: user._id, id }).lean();
    if (existingById) {
      if (isSameExpensePayload(existingById, { expenseName, expenseCategory: normalizedCategory, expenseAmount, expenseDate })) {
        const replayResponse = await buildReplayResponse(user._id, existingById);
        return res.status(201).json(replayResponse);
      }
      return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
    }

    let finalDescription = expenseDescription;
    
    // Generate a description via ML when none was provided.
    if (!expenseDescription || expenseDescription.trim() === '') {
        try {
            const response = await axios.post(
              buildMlServiceUrl("/generate-description"),
              {
                  expenseName,
                  expenseCategory: normalizedCategory,
                  expenseAmount
              },
              { timeout: 5000, headers: mlOperationsHeaders() }
            );

            finalDescription = response.data.description;
        } catch (mlErr) {
            console.error('ML description generation failed, falling back to "Others":', mlErr.message);
            finalDescription = "";
        }
    }

    // Create new expense document linked to the authenticated user
    const newExpense = new ExpenseModel({
        userId: user._id,
        id,
        expenseName,
        expenseCategory: normalizedCategory,
        expenseAmount,
        expenseDate,
        expenseDescription: finalDescription,
        mlPredictedCategory,
        mlConfidence,
        wasMlCorrected: normalizedWasMlCorrected
    });

    // Create new ML feedback document if a genuine ML prediction is available.
    const { hasPrediction, corrected: mlCorrected } = deriveMlCorrection(
      mlPredictedCategory,
      normalizedCategory
    );

    if (hasPrediction && mlConfidence !== undefined) {
        const mlFeedback = new MlFeedbackModel({
            expenseName,
            predictedCategory: mlPredictedCategory,
            actualCategory: normalizedCategory,
            confidence: mlConfidence,
            // Backward compatibility: keep the legacy boolean aligned with
            // lifecycle status for existing backend consumers.
            corrected: mlCorrected,
            // "pending" only for a genuine, server-confirmed correction.
            status: mlCorrected ? 'pending' : null,
            userId: user._id
        });
        await mlFeedback.save();
    }

    // Phase C.1 -- reserve BEFORE the primary write. This is the durable,
    const reserved = await reserve({
      userId: user._id,
      budgetDates: [newExpense.expenseDate],
      reserveReport: true,
    });
    budgetReservations = reserved.budgetReservations;
    reportReservation = reserved.reportReservation;

    // Save expense to database. This is the point the expense mutation
    writeStatus = "dispatched-ambiguous";
    try {
      await newExpense.save();
      writeStatus = "committed";
    } catch (saveErr) {
      // A concurrent duplicate request (same userId+id) won the race
      if (saveErr && saveErr.code === 11000) {
        // This attempt's OWN write definitively did not happen -- MongoDB's
        writeStatus = "no-write";
        await abandon({
          userId: user._id,
          budgetTokens: budgetReservations.map((r) => r.token),
          reportToken: reportReservation && reportReservation.token,
        }).catch(() => {});

        const winner = await ExpenseModel.findOne({ userId: user._id, id }).lean();
        if (winner && isSameExpensePayload(winner, { expenseName, expenseCategory: normalizedCategory, expenseAmount, expenseDate })) {
          const replayResponse = await buildReplayResponse(user._id, winner);
          return res.status(201).json(replayResponse);
        }
        return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
      }
      // Phase C.4 -- every other rejection (network/timeout/write-concern/
      throw saveErr;
    }

    // The primary write is now KNOWN to have committed -- from this point
    primaryWriteCommitted = true;

    // Cache clearing is a pure optimization (utils/expenseCache.js's own
    await clearUserExpenseCache(user._id);

    // Recalculate the budget and refresh the report. A failure in EITHER
    const derivedData = await synchronizeAfterMutation({
      userId: user._id,
      budgetDates: [newExpense.expenseDate],
      budgetTokens: budgetReservations.map((r) => r.token),
      reportToken: reportReservation && reportReservation.token,
    });

    // Send success response. The expense is authoritative and committed
    res.status(201).json({
      message: 'Expense Created Successfully',
      success: true,
      data: newExpense,
      derivedData,
      replayed: false,
    });

  } catch (err) {
    // Phase C.3/C.4 requirement #4 -- abandon() may ONLY run when this
    const canSafelyAbandon = writeStatus === "not-dispatched" || writeStatus === "no-write";
    if (
      ownerUserId &&
      canSafelyAbandon &&
      (budgetReservations.length > 0 || (reportReservation && reportReservation.token))
    ) {
      await abandon({
        userId: ownerUserId,
        budgetTokens: budgetReservations.map((r) => r.token),
        reportToken: reportReservation && reportReservation.token,
      }).catch(() => {});
    }

    // Send generic server error response.
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { addExpense };

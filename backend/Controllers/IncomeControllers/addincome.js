const { UserModel, IncomeModel } = require('../../config/Schemas');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');

// Remediation Workstream B -- income-creation idempotency + report sync.

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const INVALID_IDEMPOTENCY_KEY_RESPONSE = {
  success: false,
  message: 'A valid request identifier (id) is required.',
  errorCode: 'INVALID_IDEMPOTENCY_KEY',
};

const IDEMPOTENCY_CONFLICT_RESPONSE = {
  success: false,
  message: 'A different income record was already submitted with this request identifier.',
  errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
};

// Validates the client-supplied idempotency key: primitive string only,
function normalizeIdempotencyKey(rawValue) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (trimmed === '' || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) return null;
  return trimmed;
}

// The "materially the same request" check -- source, amount, and date are
const isSameIncomePayload = (stored, incoming) => {
  if (!stored) return false;

  const sourceMatches =
    String(stored.incomeSource ?? '').trim() === String(incoming.incomeSource ?? '').trim();
  const amountMatches = Number(stored.incomeAmount) === Number(incoming.incomeAmount);

  const storedDate = new Date(stored.incomeDate);
  const incomingDate = new Date(incoming.incomeDate);
  const dateMatches =
    !Number.isNaN(storedDate.getTime()) &&
    !Number.isNaN(incomingDate.getTime()) &&
    storedDate.getTime() === incomingDate.getTime();

  return sourceMatches && amountMatches && dateMatches;
};

// Builds the replay success response: the identical 2xx contract a first
const buildReplayResponse = async (userId, existingIncome) => {
  const derivedData = await synchronizeAfterMutation({ userId });

  return {
    message: 'Income Created Successfully',
    success: true,
    data: existingIncome,
    derivedData,
    replayed: true,
  };
};

const addIncome = async (req, res) => {
  // Same crash-gap-closing reservation lifecycle addexpense.js/editExpense.js
  let ownerUserId = null;
  let reportReservation = null;
  let writeStatus = "not-dispatched"; // not-dispatched | dispatched-ambiguous | no-write | committed

  try {
    // Destructure income data from request body. `id` is the client-supplied
    const { incomeSource, incomeAmount, incomeDate, id } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }
    ownerUserId = user._id;

    const idempotencyKey = normalizeIdempotencyKey(id);
    if (idempotencyKey === null) {
      return res.status(400).json(INVALID_IDEMPOTENCY_KEY_RESPONSE);
    }

    // Idempotency check -- BEFORE any write. Ownership-scoped: the lookup is
    const existingByKey = await IncomeModel.findOne({ userId: user._id, idempotencyKey }).lean();
    if (existingByKey) {
      if (isSameIncomePayload(existingByKey, { incomeSource, incomeAmount, incomeDate })) {
        const replayResponse = await buildReplayResponse(user._id, existingByKey);
        return res.status(201).json(replayResponse);
      }
      return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
    }

    // Reserve BEFORE the primary write -- durable pre-write evidence that
    const reserved = await reserve({ userId: user._id, reserveReport: true });
    reportReservation = reserved.reportReservation;

    // Create new income document linked to the authenticated user
    const newIncome = new IncomeModel({
      userId: user._id,
      incomeSource,
      incomeAmount,
      incomeDate,
      idempotencyKey,
    });

    // Save income to database. writeStatus flips to "dispatched-ambiguous"
    writeStatus = "dispatched-ambiguous";
    try {
      await newIncome.save();
      writeStatus = "committed";
    } catch (saveErr) {
      // A concurrent duplicate request (same userId+idempotencyKey) won the
      if (saveErr && saveErr.code === 11000) {
        writeStatus = "no-write";
        await abandon({
          userId: user._id,
          reportToken: reportReservation && reportReservation.token,
        }).catch(() => {});

        const winner = await IncomeModel.findOne({ userId: user._id, idempotencyKey }).lean();
        if (winner && isSameIncomePayload(winner, { incomeSource, incomeAmount, incomeDate })) {
          const replayResponse = await buildReplayResponse(user._id, winner);
          return res.status(201).json(replayResponse);
        }
        return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
      }
      // Every other rejection is ambiguous -- rethrown, writeStatus stays
      throw saveErr;
    }

    // The primary write is now KNOWN to have committed.
    const derivedData = await synchronizeAfterMutation({
      userId: user._id,
      reportToken: reportReservation && reportReservation.token,
    });

    // Send success response. The income is authoritative and committed
    // regardless of derivedData.status.
    res.status(201).json({
      message: 'Income Created Successfully',
      success: true,
      data: newIncome,
      derivedData,
      replayed: false,
    });

  } catch (err) {
    // abandon() may ONLY run when this attempt's primary write is
    const canSafelyAbandon = writeStatus === "not-dispatched" || writeStatus === "no-write";
    if (
      ownerUserId &&
      canSafelyAbandon &&
      reportReservation &&
      reportReservation.token
    ) {
      await abandon({
        userId: ownerUserId,
        reportToken: reportReservation.token,
      }).catch(() => {});
    }

    // Send generic server error response.
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { addIncome };

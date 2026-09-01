const mongoose = require('mongoose');
const { UserModel, IncomeModel } = require('../../config/Schemas');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');

// Remediation Workstream B -- report/cache synchronization. Edit is left
const editIncome = async (req, res) => {
  let ownerUserId = null;
  let reportReservation = null;
  let writeStatus = "not-dispatched"; // not-dispatched | dispatched-ambiguous | no-write | committed

  try {
    // Destructure updated data from request body
    const { incomeId, newAmount } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }
    ownerUserId = user._id;

    // Reject malformed income IDs.
    if (!mongoose.isValidObjectId(incomeId)) {
      return res.status(400).json({ success: false, message: 'Invalid income ID' });
    }

    // Reserve BEFORE the primary write -- durable pre-write evidence that
    const reserved = await reserve({ userId: user._id, reserveReport: true });
    reportReservation = reserved.reportReservation;

    // Update the caller's own income record atomically. writeStatus flips to
    writeStatus = "dispatched-ambiguous";
    let income;
    try {
      income = await IncomeModel.findOneAndUpdate(
        {
          _id: incomeId,
          userId: user._id
        },
        {
          $set: { incomeAmount: newAmount }
        },
        {
          new: true,
          runValidators: true
        }
      );
    } catch (writeErr) {
      throw writeErr;
    }

    if (!income) {
      // A RESOLVED null is conclusive proof this exact request's update
      // matched no document -- release the reservation.
      writeStatus = "no-write";
      await abandon({
        userId: user._id,
        reportToken: reportReservation && reportReservation.token,
      }).catch(() => {});
      return res.status(404).json({ message: 'Income not found', success: false });
    }

    // The primary write is now KNOWN to have committed.
    writeStatus = "committed";

    const derivedData = await synchronizeAfterMutation({
      userId: user._id,
      reportToken: reportReservation && reportReservation.token,
    });

    // Send success response. The edit is authoritative and committed
    // regardless of derivedData.status.
    res.status(200).json({
      message: 'Income updated successfully',
      success: true,
      data: income,
      derivedData,
    });

  } catch (err) {
    // abandon() may ONLY run when this attempt's primary write is
    // definitively known to have never committed.
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

module.exports = { editIncome };

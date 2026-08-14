const mongoose = require("mongoose");
const { UserModel, IncomeModel } = require("../../config/Schemas");
const { synchronizeAfterMutation, reserve, abandon } = require("../../Services/syncRecoveryService");

// Remediation Workstream B -- report/cache synchronization. Delete is left
// with its existing, simpler contract: a retried
// `DELETE /income/delete` for an already-deleted record naturally 404s with
// no further side effect (findOneAndDelete is inherently idempotent in
// effect -- a second attempt matches no document), so no idempotency key
// was added here. What WAS missing is that a successful delete never
// advanced the user's derived-data revision, invalidated any cache entry, or
// triggered a report refresh -- a cached/stored report could keep counting a
// deleted income record indefinitely. This now uses the same
// reserve()/write/synchronizeAfterMutation() reliability lifecycle
// addexpense.js/editExpense.js/editIncome.js already use.
const deleteIncome = async (req, res) => {
  let ownerUserId = null;
  let reportReservation = null;
  let writeStatus = "not-dispatched"; // not-dispatched | dispatched-ambiguous | no-write | committed

  try {
    const { deleteIncomeId } = req.body;

    const user = await UserModel.findById(req.userId);

    if (!user) {
      return res.status(401).json({
        message: "User does not exist",
        success: false,
      });
    }
    ownerUserId = user._id;

    // Reject malformed income IDs.
    if (!mongoose.isValidObjectId(deleteIncomeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid income ID",
      });
    }

    // Reserve BEFORE the primary write -- durable pre-write evidence that
    // survives a process crash between the write committing and the
    // post-write confirm() call inside synchronizeAfterMutation().
    const reserved = await reserve({ userId: user._id, reserveReport: true });
    reportReservation = reserved.reportReservation;

    // Delete the caller's own income record. writeStatus flips to
    // "dispatched-ambiguous" IMMEDIATELY BEFORE this call -- if it rejects,
    // that does not prove the delete never landed.
    writeStatus = "dispatched-ambiguous";
    let deletedIncome;
    try {
      deletedIncome = await IncomeModel.findOneAndDelete({
        _id: deleteIncomeId,
        userId: user._id
      });
    } catch (writeErr) {
      throw writeErr;
    }

    if (!deletedIncome) {
      writeStatus = "no-write";
      await abandon({
        userId: user._id,
        reportToken: reportReservation && reportReservation.token,
      }).catch(() => {});
      return res.status(404).json({
        message: "Income not found",
        success: false,
      });
    }

    // The primary write is now KNOWN to have committed.
    writeStatus = "committed";

    const derivedData = await synchronizeAfterMutation({
      userId: user._id,
      reportToken: reportReservation && reportReservation.token,
    });

    return res.status(200).json({
      message: "Income deleted successfully",
      success: true,
      derivedData,
    });

  } catch (err) {
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

    console.error(err);

    return res.status(500).json({
      message: "Internal Server Error",
      success: false,
    });
  }
};

module.exports = { deleteIncome };

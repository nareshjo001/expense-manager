const mongoose = require("mongoose");
const { UserModel, IncomeModel } = require("../../config/Schemas");
const { synchronizeAfterMutation, reserve, abandon } = require("../../Services/syncRecoveryService");

// Remediation Workstream B -- report/cache synchronization. Delete is left
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
    const reserved = await reserve({ userId: user._id, reserveReport: true });
    reportReservation = reserved.reportReservation;

    // Delete the caller's own income record. writeStatus flips to
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

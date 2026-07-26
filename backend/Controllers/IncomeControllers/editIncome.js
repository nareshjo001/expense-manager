const mongoose = require('mongoose');
const { UserModel, IncomeModel } = require('../../config/Schemas');

const editIncome = async (req, res) => {
  try {
    // Destructure updated data from request body
    const { incomeId, newAmount } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Validate the ID's format before querying the income record — a
    // malformed id would otherwise reach Mongoose's ObjectId cast and throw
    // a CastError, surfacing as a generic 500 instead of a clean 400. This
    // preserves the existing order of checks (auth first, unchanged).
    if (!mongoose.isValidObjectId(incomeId)) {
      return res.status(400).json({ success: false, message: 'Invalid income ID' });
    }

    // Atomically find-and-update in a single ownership-scoped operation, so
    // there's no window between reading the document and writing it back
    // where a concurrent delete (or another concurrent edit) could race
    // against this request.
    const income = await IncomeModel.findOneAndUpdate(
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

    if (!income) {
      return res.status(404).json({ message: 'Income not found', success: false });
    }

    // Send success response
    res.status(200).json({ message: 'Income updated successfully', success: true });

  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { editIncome };
const { UserModel, IncomeModel } = require("../../config/Schemas");

const deleteIncome = async (req, res) => {
  try {
    const { deleteIncomeId } = req.body;

    const user = await UserModel.findById(req.userId);

    if (!user) {
      return res.status(401).json({
        message: "User does not exist",
        success: false,
      });
    }

    const deletedIncome = await IncomeModel.findByIdAndDelete(deleteIncomeId);

    if (!deletedIncome) {
      return res.status(404).json({
        message: "Income not found",
        success: false,
      });
    }

    return res.status(200).json({
      message: "Income deleted successfully",
      success: true,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Internal Server Error",
      success: false,
    });
  }
};

module.exports = { deleteIncome };
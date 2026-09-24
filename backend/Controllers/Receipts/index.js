module.exports = {
    listReceiptsController: require('./list').listReceiptsController,
    getReceiptDetailController: require('./detail').getReceiptDetailController,
    getReceiptImageController: require('./image').getReceiptImageController,
    linkReceiptController: require('./link').linkReceiptController,
    unlinkReceiptController: require('./unlink').unlinkReceiptController,
    markReceiptReviewedController: require('./reviewed').markReceiptReviewedController,
    deleteReceiptController: require('./delete').deleteReceiptController,
    getReceiptDuplicatesController: require('./duplicates').getReceiptDuplicatesController,
    recordDuplicateDecisionController: require('./duplicateDecision').recordDuplicateDecisionController,
}

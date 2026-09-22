const router = require('express').Router();

// ---------------- BUDGET CONTROLLERS ----------------
const {
    getbudgets,
    setbudget,
    updatebudget,
} = require('../Controllers/BudgetControllers');

// ---------------- AUTH MIDDLEWARE ----------------
// Verifies JWT token before allowing access
const verifyToken = require('../Middlewares/Auth');

// ---------------- PUSH NOTIFICATIONS & EXPENSE RECURRING ----------------
const { deviceRegistration } = require('../Controllers/PushNotifications/deviceRegistration');
// NOT-003-T06 -- explicit user-initiated device-token revocation.
const { revokeDeviceToken } = require('../Controllers/PushNotifications/deviceRevocation');
const {
    recurring,
    getUpcoming,
    listRecurring,
    getRecurringDetail,
    pauseRecurring,
    resumeRecurring,
    endRecurring,
    editRecurring,
} = require('../Controllers/RecurringExpenses');
// NOT-003-T02 -- per-type/quiet-hours notification preferences.
const {
    getNotificationPreferences,
    updateNotificationPreferences,
} = require('../Controllers/NotificationPreferences');
// DAT-004-T04 -- financial data export (expenses/income/budgets as CSV/JSON).
const {
    createExport,
    listExports,
    getExportStatus,
    downloadExport,
} = require('../Controllers/Export');
// IMP-001 -- CSV transaction import (headers preview, session create/list/
// get, row decisions, commit). multer wrapping mirrors Routes/bill.routes.js's
// own handleBillUpload convention (MulterError -> clean 4xx, INVALID_FILE_TYPE
// -> 415) rather than Middlewares/upload.js, since that middleware's
// fields:0 limit would reject createSession's own columnMapping text field.
const multer = require('multer');
const { importHeadersUpload, importSessionUpload } = require('../Middlewares/importUpload');
const { previewImportHeadersController } = require('../Controllers/ImportControllers/previewHeaders');
const { createImportSessionController } = require('../Controllers/ImportControllers/createSession');
const { listImportSessionsController } = require('../Controllers/ImportControllers/listSessions');
const { getImportSessionController } = require('../Controllers/ImportControllers/getSession');
const { decideImportRowController } = require('../Controllers/ImportControllers/decideRow');
const { commitImportSessionController } = require('../Controllers/ImportControllers/commitSession');

const handleImportUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(isTooLarge ? 413 : 400).json({
        success: false,
        errorCode: isTooLarge ? 'FILE_TOO_LARGE' : 'IMPORT_UPLOAD_INVALID',
        message: isTooLarge ? 'Import files must be 2 MB or smaller.' : 'Upload exactly one CSV file.',
      });
    }
    if (err && err.code === 'INVALID_FILE_TYPE') {
      return res.status(415).json({
        success: false,
        errorCode: 'IMPORT_UNSUPPORTED_FILE_TYPE',
        message: 'Upload a CSV file.',
      });
    }
    if (err) {
      return next(err);
    }
    next();
  });
};

// OCR-004-T04 -- receipt inbox: list/detail/image/link/unlink/reviewed/delete
// over persisted Receipt documents (see backend/models/Receipt.js and
// backend/utils/receiptLifecycle.js for the fixed contract this builds on).
const {
    listReceiptsController,
    getReceiptDetailController,
    getReceiptImageController,
    linkReceiptController,
    unlinkReceiptController,
    markReceiptReviewedController,
    deleteReceiptController,
    getReceiptDuplicatesController,
    recordDuplicateDecisionController,
} = require('../Controllers/Receipts');

// ================= BUDGET ROUTES =================

// Get budgets
router.get('/getbudgets', verifyToken, getbudgets);

// Set budget
router.post('/setbudget', verifyToken, setbudget);

// Update budget
router.put('/update-budget', verifyToken, updatebudget);

// ================= DEVICE / RECURRING ROUTES =================

// Device registration for push notifications
router.post('/device-token', verifyToken, deviceRegistration);
// NOT-003-T06 -- revoke one of the caller's own device tokens.
router.delete('/device-token', verifyToken, revokeDeviceToken);

// NOT-003-T02 -- per-type/quiet-hours notification preferences.
router.get('/notification-preferences', verifyToken, getNotificationPreferences);
router.put('/notification-preferences', verifyToken, updateNotificationPreferences);

// Mark expense recurring
router.patch('/recurring', verifyToken, recurring);

// REC-003-T02 -- projected upcoming occurrences, bounded by an explicit
// date window (see Controllers/RecurringExpenses/upcoming.js for why the
// window is capped rather than optional).
router.get('/recurring/upcoming', verifyToken, getUpcoming);

// REC-002-T02 -- list/detail views over recurring definitions. Registered
// AFTER /recurring/upcoming so that literal segment never gets swallowed by
// the :id wildcard below (Express matches route registration order).
router.get('/recurring', verifyToken, listRecurring);
router.get('/recurring/:id', verifyToken, getRecurringDetail);

// REC-002-T02/T04 -- lifecycle mutations. Each requires scheduleVersion in
// the body for compare-and-set (see Controllers/RecurringExpenses/lifecycle.js).
router.patch('/recurring/:id/pause', verifyToken, pauseRecurring);
router.patch('/recurring/:id/resume', verifyToken, resumeRecurring);
router.patch('/recurring/:id/end', verifyToken, endRecurring);
router.patch('/recurring/:id', verifyToken, editRecurring);

// ================= EXPORT ROUTES =================
// DAT-004-T04 -- always scoped to the authenticated user (req.userId);
// there is no unauthenticated export endpoint. Registered in
// create/list/status/download order, matching the order they're documented
// in Controllers/Export -- no ordering hazard between them the way
// /recurring/upcoming has with /recurring/:id above, since none of these
// paths overlap another route's wildcard segment.
router.post('/export', verifyToken, createExport);
router.get('/export', verifyToken, listExports);
router.get('/export/:id/status', verifyToken, getExportStatus);
router.get('/export/download/:token', verifyToken, downloadExport);

// ================= RECEIPT ROUTES =================
// OCR-004-T04 -- always scoped to the authenticated user (req.userId); a
// receipt document that exists but belongs to another user 404s the same
// way a nonexistent id does (see receiptQueryService.js's own comment on
// why NOT_FOUND deliberately never distinguishes the two). Registered in
// list/detail/image/link/unlink/reviewed/delete order.
router.get('/receipts', verifyToken, listReceiptsController);
router.get('/receipts/:id', verifyToken, getReceiptDetailController);
router.get('/receipts/:id/image', verifyToken, getReceiptImageController);
router.post('/receipts/:id/link', verifyToken, linkReceiptController);
router.post('/receipts/:id/unlink', verifyToken, unlinkReceiptController);
router.post('/receipts/:id/reviewed', verifyToken, markReceiptReviewedController);
router.delete('/receipts/:id', verifyToken, deleteReceiptController);
// OCR-005-T04 -- receipt duplicate-candidate detection and decision
// recording (see backend/utils/duplicateDetectionRules.js and
// Services/ReceiptServices/duplicateCandidateService.js).
router.get('/receipts/:id/duplicates', verifyToken, getReceiptDuplicatesController);
router.post('/receipts/:id/duplicate-decision', verifyToken, recordDuplicateDecisionController);


// ================= CSV IMPORT ROUTES =================
// IMP-001 -- always scoped to the authenticated user (req.userId); an
// ImportSession belonging to another user 404s the same way a nonexistent
// id does, mirroring the receipts routes' own NOT_FOUND convention above.
// Registered in headers/create/list/get/decide/commit order.
router.post('/imports/headers', verifyToken, handleImportUpload(importHeadersUpload.single('file')), previewImportHeadersController);
router.post('/imports/sessions', verifyToken, handleImportUpload(importSessionUpload.single('file')), createImportSessionController);
router.get('/imports/sessions', verifyToken, listImportSessionsController);
router.get('/imports/sessions/:id', verifyToken, getImportSessionController);
router.patch('/imports/sessions/:id/rows/:rowIndex', verifyToken, decideImportRowController);
router.post('/imports/sessions/:id/commit', verifyToken, commitImportSessionController);

module.exports = router;

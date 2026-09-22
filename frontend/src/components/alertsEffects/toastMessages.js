import { toast } from 'react-toastify';

// Preconfigured react-toastify variants for auth, expense, and income feedback messages.
const loginSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Welcome {data.firstname}
        </div>,
        {
            position: "bottom-left",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
                boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
                maxWidth: "250px",
                padding: "12px 20px",
                border: "1px solid rgba(6, 95, 70, 0.3)",
            },
            containerId: "below-header",
        }
    );
};

const logInErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message} !
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const signUpSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div>
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {data.message}
        </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const signUpErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const expenseAddSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {data.message}!
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const expenseAddErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// Phase C -- Expense Mutation Reliability: `isPending` is true when the
const deleteSuccessToast = (isPending = false) => {
    toast.dismiss();
    toast.success(
        <div>
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {isPending
                    ? "Expense deleted. Budget and insights are still refreshing."
                    : "Deleted Successfully!"}
        </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// OCR-003 -- lets the user know a receipt parsed but some fields look
// uncertain (low OCR confidence, or no total found), so they know to
// double-check before saving rather than assuming everything is right.
const receiptNeedsReviewToast = () => {
    toast.dismiss();
    toast.warning(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            We couldn't confidently read every field on this receipt. Please double-check before saving.
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fef3c7",
                color: "#92400e",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// CAT-001 -- confirms a merchant rule was saved (post-correction prompt or the rule management screen).
const merchantRuleSaveSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Rule saved! Future expenses from this merchant will use this category.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const merchantRuleSaveErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't save the rule."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// CAT-001 -- confirms a merchant rule was deleted from the rule management screen.
const merchantRuleDeleteSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Rule deleted.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const merchantRuleDeleteErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't delete the rule."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const deleteErrorToast = () => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                Deletion Failed!
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// REC-002-T05 -- recurring-definition lifecycle action feedback.
const recurringActionSuccessToast = (message) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {message}
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const recurringActionErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't update this recurring expense."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};


// NOT-003-T05 -- notification-preferences save feedback.
const notificationPreferencesSaveSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Notification preferences saved
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const notificationPreferencesSaveErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't save your notification preferences."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};


// DAT-004 -- financial data export feedback. A "queued" toast for the
// background/large-export path (the request just landed in the queue; the
// past-exports list is what actually reflects it going ready, per
// DataExport.js's own comment on why no separate "ready" toast fires from
// here), a "download ready" toast for the small/sync path where the file
// downloaded immediately, and an error toast that maps the contract's
// errorCode values to a message a user can act on rather than the raw code.
const EXPORT_ERROR_MESSAGES = {
    INVALID_DOMAIN: "That data type isn't available to export.",
    INVALID_FORMAT: "That export format isn't supported.",
    INVALID_COMBINATION: "That combination isn't supported -- exporting all data only works as JSON.",
    TOO_MANY_ROWS: "That export has too many rows to generate right now. Try narrowing the date range.",
    MISSING_FIELDS: "Please choose a data type and format before exporting.",
};

const exportQueuedToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Export queued -- it'll show up below once it's ready to download.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const exportDownloadReadyToast = (filename) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {filename ? `${filename} downloaded.` : "Your export downloaded."}
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const exportCreateErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {EXPORT_ERROR_MESSAGES[data.errorCode] || data.message || "Couldn't create this export."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// OCR-004 -- receipt inbox action feedback: linking/unlinking a receipt to
// an expense, saving a review correction, and deleting a receipt. Error
// toasts map the contract's errorCode values to a message a user can act
// on, same EXPORT_ERROR_MESSAGES-style lookup exportCreateErrorToast above
// already uses, falling back to the server's own message or a generic one.
const RECEIPT_LINK_ERROR_MESSAGES = {
    EXPENSE_NOT_FOUND: "That expense couldn't be found.",
    ALREADY_LINKED_TO_ANOTHER_EXPENSE: "This receipt is already linked to a different expense.",
};

const receiptLinkSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Receipt linked to the expense.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptLinkErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {RECEIPT_LINK_ERROR_MESSAGES[data.errorCode] || data.message || "Couldn't link this receipt."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptUnlinkSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Receipt unlinked.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptUnlinkErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't unlink this receipt."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptReviewSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Receipt marked as reviewed.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptReviewErrorToast = (data = {}) => {
    toast.dismiss();
    const message = data.errorCode === "INVALID_CORRECTION"
        ? "One of the corrected values isn't valid. Please check and try again."
        : (data.message || "Couldn't save this receipt's review.");

    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {message}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptDeleteSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Receipt deleted.
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptDeleteErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't delete this receipt."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// OCR-005 -- duplicate-decision feedback: confirming a receipt as new, or
// linking it to the existing receipt it duplicates. Same
// success/error-toast shape as the OCR-004 receipt toasts above, falling
// back to the server's own message when there isn't a friendlier one to
// show, same as receiptUnlinkErrorToast/receiptDeleteErrorToast.
const RECEIPT_DUPLICATE_DECISION_MESSAGES = {
    confirmed_new: "Kept as a new receipt.",
    linked_existing: "Linked to the existing receipt.",
};

const receiptDuplicateDecisionSuccessToast = (decision) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {RECEIPT_DUPLICATE_DECISION_MESSAGES[decision] || "Duplicate decision saved."}
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const receiptDuplicateDecisionErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message || "Couldn't save this decision."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

// IMP-001 -- CSV bulk import feedback: creating a preview session, and
// committing it. Error toasts map the contract's errorCode values to a
// message a user can act on, same lookup-by-errorCode shape
// EXPORT_ERROR_MESSAGES/RECEIPT_LINK_ERROR_MESSAGES above already use,
// falling back to the server's own message or a generic one.
//
// Deliberately NO success/error toast for a single row's accept/skip
// decision (useDecideImportRowMutation) -- the preview table's own
// running totals and per-row state already give immediate visible
// feedback, and a session can have dozens of rows, so a toast per click
// would stack up and become noise rather than signal (see the "skip
// toasting per-row if that would be too noisy" guidance this was built
// against). A row-decision failure surfaces inline instead, the same way
// the preview table already renders each row's own state.
const IMPORT_ERROR_MESSAGES = {
    IMPORT_EMPTY_FILE: "That file is empty.",
    IMPORT_TOO_MANY_ROWS: "This file has too many rows -- the limit is 5,000.",
    IMPORT_MALFORMED_ROW: "This file has a row that couldn't be read. Please check its formatting.",
    FILE_TOO_LARGE: "This file is too large to upload.",
    INVALID_MAPPING: "Please map date, amount, and merchant to columns in your file.",
};

const importSessionCreatedToast = (rowCount) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {typeof rowCount === 'number'
                ? `File mapped -- ${rowCount} row${rowCount === 1 ? '' : 's'} ready to review.`
                : "File mapped -- review the rows below."}
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const importSessionCreateErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {IMPORT_ERROR_MESSAGES[data.errorCode] || data.message || "Couldn't read this file. Please try again."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const importCommitSuccessToast = (committedCount) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {`Import complete -- ${committedCount} expense${committedCount === 1 ? '' : 's'} added.`}
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const IMPORT_COMMIT_ERROR_MESSAGES = {
    ALREADY_COMMITTING: "This import is already being committed.",
    SESSION_EXPIRED: "This import session has expired. Please start a new import.",
};

const importCommitErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {IMPORT_COMMIT_ERROR_MESSAGES[data.errorCode] || data.message || "Couldn't commit this import."}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 4000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

export {
    loginSuccessToast,
    logInErrorToast,
    signUpSuccessToast,
    signUpErrorToast,
    expenseAddSuccessToast,
    expenseAddErrorToast,
    deleteSuccessToast,
    deleteErrorToast,
    merchantRuleSaveSuccessToast,
    merchantRuleSaveErrorToast,
    merchantRuleDeleteSuccessToast,
    merchantRuleDeleteErrorToast,
    receiptNeedsReviewToast,
    recurringActionSuccessToast,
    recurringActionErrorToast,
    notificationPreferencesSaveSuccessToast,
    notificationPreferencesSaveErrorToast,
    exportQueuedToast,
    exportDownloadReadyToast,
    exportCreateErrorToast,
    receiptLinkSuccessToast,
    receiptLinkErrorToast,
    receiptUnlinkSuccessToast,
    receiptUnlinkErrorToast,
    receiptReviewSuccessToast,
    receiptReviewErrorToast,
    receiptDeleteSuccessToast,
    receiptDeleteErrorToast,
    receiptDuplicateDecisionSuccessToast,
    receiptDuplicateDecisionErrorToast,
    importSessionCreatedToast,
    importSessionCreateErrorToast,
    importCommitSuccessToast,
    importCommitErrorToast
};

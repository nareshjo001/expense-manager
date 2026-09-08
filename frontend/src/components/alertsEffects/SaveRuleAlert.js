import React from 'react';
import '../landingPage/LandingPage.css';
import { useModalA11y } from '../hooks/useModalA11y';

// CAT-001-T05 -- shown after a user submits an expense whose predicted
// category they corrected; offers to save the correction as a durable
// merchant rule so future expenses from this merchant skip ML entirely.
// Shares DeleteAlert's modal-overlay/modal styling for visual consistency,
// and (FE-a11y) the same useModalA11y dialog behavior: focus-in on open,
// Tab trap, Escape-to-cancel, focus restored on close.
const SaveRuleAlert = ({ merchantName, category, isSaving, onConfirm, onCancel }) => {
    const dialogRef = React.useRef(null);
    useModalA11y(dialogRef, onCancel, !isSaving);

    return (
        <div className="modal-overlay">
            <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="save-rule-alert-message"
                ref={dialogRef}
                tabIndex={-1}
            >
                <p id="save-rule-alert-message">
                    Remember that <strong>{merchantName}</strong> is always <strong>{category}</strong>?
                </p>

                <div className="modal-buttons">
                    <button onClick={onCancel} disabled={isSaving}>No thanks</button>
                    <button onClick={onConfirm} disabled={isSaving}>
                        {isSaving ? 'Saving…' : 'Save rule'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SaveRuleAlert;

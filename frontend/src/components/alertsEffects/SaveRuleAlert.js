import React from 'react';
import '../landingPage/LandingPage.css';

// CAT-001-T05 -- shown after a user submits an expense whose predicted
// category they corrected; offers to save the correction as a durable
// merchant rule so future expenses from this merchant skip ML entirely.
// Shares DeleteAlert's modal-overlay/modal styling for visual consistency.
const SaveRuleAlert = ({ merchantName, category, isSaving, onConfirm, onCancel }) => {
    return (
        <div className="modal-overlay">
            <div className="modal">
                <p>
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

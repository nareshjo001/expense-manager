import React from 'react';
import '../landingPage/LandingPage.css';
import { useModalA11y } from '../hooks/useModalA11y';

// DeleteAlert is a reusable modal component for confirming a destructive action.
// `message` defaults to the original expense-delete copy so every existing caller keeps its exact behavior unchanged.
//
// FE-a11y: previously had no dialog semantics at all -- a screen reader
// announced it as plain page content, Tab could leave the dialog into the
// still-interactive page behind it, and there was no way to dismiss it with
// Escape. useModalA11y fixes all three (focus-in on open, Tab trap, Escape
// closes, focus restored to the delete trigger on close).
const DeleteAlert = ({ confirmDeleteId, confirmDeleteHandler, cancelDeleteHandler, message = 'Are you sure you want to delete this expense?' }) => {
    const dialogRef = React.useRef(null);
    useModalA11y(dialogRef, cancelDeleteHandler);

    return (
        <div className="modal-overlay">
            <div
                className="modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-alert-message"
                ref={dialogRef}
                tabIndex={-1}
            >
                <p id="delete-alert-message">{message}</p>

                <div className="modal-buttons">
                    <button onClick={cancelDeleteHandler}>Cancel</button>
                    <button onClick={confirmDeleteHandler}>Yes, Delete</button>
                </div>
            </div>
        </div>
    );
}

export default DeleteAlert;

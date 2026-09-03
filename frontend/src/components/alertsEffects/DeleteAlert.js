import React from 'react';
import '../landingPage/LandingPage.css';

// DeleteAlert is a reusable modal component for confirming a destructive action.
// `message` defaults to the original expense-delete copy so every existing caller keeps its exact behavior unchanged.
const DeleteAlert = ({ confirmDeleteId, confirmDeleteHandler, cancelDeleteHandler, message = 'Are you sure you want to delete this expense?' }) => {
    return (
        <div className="modal-overlay">
            <div className="modal">
                <p>{message}</p>

                <div className="modal-buttons">
                    <button onClick={cancelDeleteHandler}>Cancel</button>
                    <button onClick={confirmDeleteHandler}>Yes, Delete</button>
                </div>
            </div>
        </div>
    );
}

export default DeleteAlert;

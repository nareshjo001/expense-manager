import React from 'react';
import '../landingPage/LandingPage.css';

// DeleteAlert is a reusable modal component for confirming deletion of an expense.
const DeleteAlert = ({ confirmDeleteId, confirmDeleteHandler, cancelDeleteHandler }) => {
    return (
        <div className="modal-overlay">
            <div className="modal">
                <p>Are you sure you want to delete this expense?</p>

                <div className="modal-buttons">
                    <button onClick={cancelDeleteHandler}>Cancel</button>
                    <button onClick={confirmDeleteHandler}>Yes, Delete</button>
                </div>
            </div>
        </div>
    );
}

export default DeleteAlert;
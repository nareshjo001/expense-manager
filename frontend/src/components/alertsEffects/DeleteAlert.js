import React from 'react';
import '../landingPage/LandingPage.css';

// DeleteAlert is a reusable modal component for confirming deletion of an expense.
const DeleteAlert = ({ confirmDeleteId, confirmDeleteHandler, cancelDeleteHandler }) => {
    return (
        <div className="modal-overlay"> {/* Overlay background to dim the screen */}
            <div className="modal"> {/* The actual modal dialog box */}
                <p>Are you sure you want to delete this expense?</p>

                <div className="modal-buttons"> {/* Button container */}
                    {/* Cancel deletion button */}
                    <button onClick={cancelDeleteHandler}>Cancel</button>
                    
                    {/* Confirm deletion button */}
                    <button onClick={confirmDeleteHandler}>Yes, Delete</button>

                </div>
            </div>
        </div>
    );
}

export default DeleteAlert;
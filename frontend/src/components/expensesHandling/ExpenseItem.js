import React, { useState, useEffect } from "react";
import "./ExpenseItem.css";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "../hooks/useIsMobile";

import { signUpSuccessToast, signUpErrorToast } from "../alertsEffects/toastMessages";

const ExpenseItem = ({ expense, onDelete, setIsEdit }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  
  // Controls mobile action menu visibility
  const [showMenu, setShowMenu] = useState(false);

  const [isRecurring, setIsRecurring] = useState(expense.isRecurring);

  /**
   * Close mobile menu automatically when switching
   * from mobile → desktop view.
  */
  useEffect(() => {
    if (!isMobile && showMenu) {
      setShowMenu(false);
    }
  }, [isMobile, showMenu]);

  // Navigate to AddExpense page in edit mode
  const handleEdit = () => {
    setIsEdit({ enableEdit: true, expense_id: expense._id });
    navigate("/add");
  };

  // Recurring feature
  const handleRecurring = async () => {
    
    const token = localStorage.getItem("token");
    const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

    const newRecurringState = !isRecurring;

    const payload = {
      expenseId: expense._id,
      isRecurring: newRecurringState
    };

    try {

      const response = await fetch(`${BASE_URL}/auth/recurring`, {
        method: 'PATCH',
        headers: {
          'Content-type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json();

      if(response.ok) {
        setIsRecurring(newRecurringState);
        signUpSuccessToast(data);
      } else {
        signUpErrorToast(data);
      }

    } catch(err) {
      console.log("Error Make recurring: ", err);
    }
  };

  // Formats date as: "Today / X days ago • DD Mon YYYY"
  const formatDate = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();

    const diffMs = now - date;
    const diffDays = Math.max(
      0,
      Math.floor(diffMs / (1000 * 60 * 60 * 24))
    );

    let relative;
    if (diffDays === 0) {
      relative = "Today";
    } else if (diffDays === 1) {
      relative = "1 day ago";
    } else {
      relative = `${diffDays} days ago`;
    }

    const absolute = date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    return `${relative} • ${absolute}`;
  };

  useEffect(() => {
    setIsRecurring(expense.isRecurring);
  }, [expense.isRecurring]);

  return (
    <div className={`expense-card ${showMenu ? "menu-open" : ""}`}>
      <div className="expense-header">
        <span className="expense-title">{expense.expenseName}</span>

        {/* RIGHT SIDE */}
        <div className="expense-actions">
          {/* Amount (moves on hover) */}
          <span className="expense-amount">
            {isMobile ? (
                <span>₹{expense.expenseAmount}</span>
              ) : (
                <span>Amount: ₹{expense.expenseAmount}</span>
              )}
          </span>

          {/* Desktop actions (overlay, no layout space) */}
          <div className="desktop-actions">
            
            <button className="icon-btn edit" onClick={handleEdit} title="Edit">
              <svg viewBox="0 0 24 24" className="icon">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
              </svg>
            </button>

            <button className="icon-btn recurring" onClick={handleRecurring} title={isRecurring ? "Unmark recurring" : "Mark recurring"}>
              {!isRecurring ?
                  <svg viewBox="0 0 24 24" className="icon">
                    <path d="M17 1l4 4-4 4"></path>
                    <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                    <path d="M7 23l-4-4 4-4"></path>
                    <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                  </svg>
                :
                  <svg viewBox="0 0 24 24" className="icon">
                    <circle cx="12" cy="12" r="9" />
                    <line x1="8" y1="8" x2="16" y2="16" />
                    <line x1="16" y1="8" x2="8" y2="16" />
                  </svg>
              }
            </button>
            
            <button className="icon-btn delete" onClick={() => onDelete(expense._id)} title="Delete" >
              <svg viewBox="0 0 24 24" className="icon">
                <polyline points="3 6 5 6 21 6"></polyline>

                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>

                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>

                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
              </svg>
            
            </button>
          </div>

          {/* Mobile menu */}
          <button
            className="mobile-menu-btn"
            onClick={() => setShowMenu((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" className="icon">
              <circle cx="12" cy="5" r="1.5"></circle>
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="12" cy="19" r="1.5"></circle>
            </svg>
          </button>
        </div>
      </div>

      <div className="expense-details">
        {/* <span className="expense-description">
          {expense.expenseCategory}
        </span> */}

        <span className="expense-description">
          {expense.expenseDescription}
        </span>

        <span className="expense-date">
          <span className="date-text">
            {formatDate(expense.expenseDate)}
          </span>

          {/* <svg viewBox="0 0 24 24" className="icon clock">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg> */}
        </span>
      </div>

      {/* Mobile menu */}
      {showMenu && (
        <div className="mobile-menu">
          <button onClick={handleEdit}>Edit</button>

          <button onClick={() => onDelete(expense._id)}>Delete</button>

          <button onClick={handleRecurring}>
            {isRecurring ? 'Unmark recurring' : 'Mark Recurring'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ExpenseItem;
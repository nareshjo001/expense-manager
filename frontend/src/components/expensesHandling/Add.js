import { useState } from 'react';
import AddExpense from './AddExpense';
import AddIncome from './AddIncome';
import './AddExpense.css';

// Toggles between the Add Expense and Add Income forms.
const Add = ({ isEdit, setIsEdit }) => {
  const [type, setType] = useState("expense");

  return (
    <div className="add-page">
      <div className="form-toggle">
        <div
          className={`form-toggle-slider ${
            type === "income" ? "right" : ""
          }`}
        />

        <button
          className={type === "expense" ? "active" : ""}
          onClick={() => setType("expense")}
        >
          Add Expense
        </button>

        <button
          className={type === "income" ? "active" : ""}
          onClick={() => setType("income")}
        >
          Add Income
        </button>
      </div>

      {type === "expense" ? <AddExpense isEdit={isEdit} setIsEdit={setIsEdit} /> : <AddIncome />}
    </div>
  );
};

export default Add;
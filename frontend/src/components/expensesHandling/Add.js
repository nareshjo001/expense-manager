import { useState } from 'react';
import { HiChartBar, HiOutlineCreditCard } from 'react-icons/hi2';
import AddExpense from './AddExpense';
import AddIncome from './AddIncome';
import './AddExpense.css';

// Toggles between the Add Expense and Add Income forms.
const Add = ({ isEdit, setIsEdit }) => {
  const [type, setType] = useState("expense");

  return (
    <div className="add-page">
      <div className="form-toggle add-form-toggle">
        <div
          className={`form-toggle-slider ${
            type === "income" ? "right" : ""
          }`}
        />

        <button
          className={type === "expense" ? "active" : ""}
          onClick={() => setType("expense")}
          aria-pressed={type === "expense"}
        >
          <span className="add-form-toggle-icon" aria-hidden="true">
            <HiOutlineCreditCard />
          </span>
          Add Expense
        </button>

        <button
          className={type === "income" ? "active" : ""}
          onClick={() => setType("income")}
          aria-pressed={type === "income"}
        >
          <span className="add-form-toggle-icon" aria-hidden="true">
            <HiChartBar />
          </span>
          Add Income
        </button>
      </div>

      {type === "expense" ? <AddExpense isEdit={isEdit} setIsEdit={setIsEdit} /> : <AddIncome />}
    </div>
  );
};

export default Add;
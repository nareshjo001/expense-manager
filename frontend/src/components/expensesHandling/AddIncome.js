import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AddExpense.css';

import Spinner from '../alertsEffects/Spinner';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../alertsEffects/toastMessages';

const AddIncome = () => {

  const [incomeSource, setSource] = useState('');
  const [incomeAmount, setAmount] = useState('');
  const [incomeDate, setDate] = useState('');

  const navigate = useNavigate();
  const [isSpinnerLoading, setIsSpinnerLoading] = useState(false);

  const sanitizeText = (text = '') => {
    return text
        .trim()
        .replace(/\s+/g, ' ');
  };

  const handleSubmit = async (e) => {
      e.preventDefault();
      setIsSpinnerLoading(true);

      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const payload = {
          incomeSource: sanitizeText(incomeSource),
          incomeAmount: +incomeAmount,
          incomeDate
      };

      try {
          let response;

          if (true) {
              // ADD INCOME
              response = await fetch(`${BASE_URL}/auth/add-income`, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                      ...payload,
                      id: Date.now().toString()
                  }),
              });
          } 

          const data = await response.json();

          if (response.ok) {
              setSource('');
              setAmount('');
              setDate('');

              navigate('/');
              expenseAddSuccessToast(data);
          } else {
              expenseAddErrorToast(data);
          }

      } catch (error) {
          console.error("Income submission error:", error);

          expenseAddErrorToast({
              message: "Server error. Please try again later."
          });
      } finally {
          setIsSpinnerLoading(false);
      }
  };

  return (
    <>
      {isSpinnerLoading && <Spinner />}
        <div className="add-expense-wrapper">
            <form className="add-expense" onSubmit={handleSubmit}>
                
                {/* Income Source Input */}
                <div className="field">
                    <label htmlFor="name">Source of the Income</label>
                    <input
                        type="text"
                        value={incomeSource}
                        id="name"
                        onChange={(e) => {setSource(e.target.value)}}
                        required
                    />
                </div>

                {/* Income Amount Input */}
                <div className="field">
                    <label htmlFor="number">Amount Received</label>
                    <input
                        type="number"
                        value={incomeAmount}
                        id="number"
                        onChange={(e) => {setAmount(e.target.value)}}
                        min={0}
                        required
                    />
                </div>

                {/* Income Date Input */}
                <div className="field">
                    <label htmlFor="date">Date Received</label>
                    <input
                        type="date"
                        id="date"
                        value={incomeDate}
                        onChange={(e) => { setDate(e.target.value) }}
                        required
                    />
                </div>

                {/* Submit Button */}
                <button className="submit-btn" type="submit">
                  "Add Income"
                </button>
            </form>
        </div>
    </>
  )
}

export default AddIncome;
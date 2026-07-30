import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AddExpense.css';

import Spinner from '../alertsEffects/Spinner';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../alertsEffects/toastMessages';
import { useAddIncomeMutation } from '../../hooks/mutations/useAddIncomeMutation';

// Income creation form.
const AddIncome = () => {

  const [incomeSource, setSource] = useState('');
  const [incomeAmount, setAmount] = useState('');
  const [incomeDate, setDate] = useState('');

  const navigate = useNavigate();
  const addIncomeMutation = useAddIncomeMutation();

  const sanitizeText = (text = '') => {
    return text
        .trim()
        .replace(/\s+/g, ' ');
  };

  const handleSubmit = (e) => {
      e.preventDefault();

      const payload = {
          incomeSource: sanitizeText(incomeSource),
          incomeAmount: +incomeAmount,
          incomeDate,
          id: Date.now().toString()
      };

      addIncomeMutation.mutate(payload, {
          onSuccess: (data) => {
              setSource('');
              setAmount('');
              setDate('');

              navigate('/');
              expenseAddSuccessToast(data);
          },
          onError: (error) => {
              // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
              const status = error.response?.status;
              if (status === 401 || status === 429 || status === 409) {
                  return;
              }

              console.error("Income submission error:", error);

              if (error.response?.data) {
                  expenseAddErrorToast(error.response.data);
              } else {
                  expenseAddErrorToast({
                      message: "Server error. Please try again later."
                  });
              }
          },
      });
  };

  return (
    <>
      {addIncomeMutation.isPending && <Spinner />}
        <div className="add-expense-wrapper">
            <form className="add-expense" onSubmit={handleSubmit}>
                
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

                <button className="submit-btn" type="submit">
                  "Add Income"
                </button>
            </form>
        </div>
    </>
  )
}

export default AddIncome;
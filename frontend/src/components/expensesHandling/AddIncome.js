import { useRef, useState } from 'react';
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

  // Final correctness pass -- an idempotency key belongs to one normalized
  const activeAttemptRef = useRef(null); // { id, fingerprint } | null

  const mintId = () =>
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Fixed-order (array, never object-key-order-dependent) serialization of
  const computeFingerprint = ({ incomeSource, incomeAmount, incomeDate }) =>
    JSON.stringify([incomeSource, incomeAmount, incomeDate]);

  const getAttemptId = (fingerprint) => {
    if (activeAttemptRef.current && activeAttemptRef.current.fingerprint === fingerprint) {
      return activeAttemptRef.current.id;
    }
    const id = mintId();
    activeAttemptRef.current = { id, fingerprint };
    return id;
  };

  const navigate = useNavigate();
  const addIncomeMutation = useAddIncomeMutation();

  const sanitizeText = (text = '') => {
    return text
        .trim()
        .replace(/\s+/g, ' ');
  };

  const handleSubmit = (e) => {
      e.preventDefault();

      // Construct the exact normalized outbound payload FIRST -- the
      const payload = {
          incomeSource: sanitizeText(incomeSource),
          incomeAmount: +incomeAmount,
          incomeDate,
      };
      const fingerprint = computeFingerprint(payload);
      const attemptId = getAttemptId(fingerprint);

      addIncomeMutation.mutate({ ...payload, id: attemptId }, {
          onSuccess: (data) => {
              setSource('');
              setAmount('');
              setDate('');

              // Committed success: this add attempt is done, whether it was
              activeAttemptRef.current = null;

              navigate('/');
              expenseAddSuccessToast(data);
          },
          onError: (error) => {
              const status = error.response?.status;

              // A definitive 409 proves this id is now permanently bound,
              if (status === 409) {
                  activeAttemptRef.current = null;
              }

              // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
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
                        step="any"
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
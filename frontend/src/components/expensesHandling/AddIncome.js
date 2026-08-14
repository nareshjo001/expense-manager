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
  // OUTBOUND PAYLOAD, not merely to "the form being open". The previous
  // design (a single lazily-minted id, reused unconditionally until
  // success) deliberately mirrored AddExpense.js's own addAttemptIdRef, but
  // that was confirmed unacceptable here: after an ambiguous failure, a
  // user who then changes source/amount/date and resubmits would keep
  // reusing the SAME id for a materially DIFFERENT payload. The backend
  // (Controllers/IncomeControllers/addincome.js's isSameIncomePayload) then
  // correctly rejects that resubmission with 409 IDEMPOTENCY_KEY_CONFLICT --
  // but with no client-side invalidation, every subsequent manual
  // resubmission stayed stuck on that same now-permanently-incompatible key
  // forever, since nothing ever minted a fresh one.
  //
  // Fix: track the active attempt as `{ id, fingerprint }`, where
  // `fingerprint` is a deterministic digest of exactly the write-relevant
  // fields (source, amount, date -- the SAME fields
  // isSameIncomePayload/backend uniqueness compares, never the id itself).
  // On each explicit submit:
  //   - no active attempt yet, OR the normalized payload's fingerprint
  //     differs from the active attempt's -- mint a NEW id (a materially
  //     different payload is a new logical attempt, never a retry of the
  //     old one);
  //   - fingerprint UNCHANGED -- reuse the SAME id (a genuine retry of an
  //     ambiguous/network/5xx failure, or of a still-in-flight request).
  // A committed success clears the active attempt entirely (the next
  // logical submission, even with identical field values, is a NEW income
  // record and must get a new id). A definitive backend 409 also clears the
  // active attempt -- that response proves THIS id is now permanently
  // bound to a different, already-committed payload server-side, so no
  // future resubmission under it could ever succeed; the next explicit
  // submit mints a fresh id instead of retrying forever with the same
  // doomed key. Re-rendering alone never touches this ref, so a fresh
  // `mutate` function identity (e.g. from React Query re-deriving the
  // mutation object) never mints or discards an id on its own.
  const activeAttemptRef = useRef(null); // { id, fingerprint } | null

  const mintId = () =>
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Fixed-order (array, never object-key-order-dependent) serialization of
  // exactly the write-relevant fields, using the SAME normalized
  // representations the outbound request itself carries (sanitized source
  // string, numeric amount, the submitted date string) -- so a
  // presentation-only difference (e.g. incidental whitespace the user
  // typed, later collapsed by sanitizeText) never produces a different
  // fingerprint than what is actually sent.
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
      // fingerprint (and therefore the id decision) is derived from these
      // same values, never from raw/un-normalized field state.
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
              // a fresh create or a replay -- the next logical submission
              // (even with identical field values) is a NEW attempt and
              // must get a new id.
              activeAttemptRef.current = null;

              navigate('/');
              expenseAddSuccessToast(data);
          },
          onError: (error) => {
              const status = error.response?.status;

              // A definitive 409 proves this id is now permanently bound,
              // server-side, to a payload that no longer matches what this
              // form would submit -- invalidate it so the next explicit
              // submission mints a fresh id rather than retrying forever
              // under the same doomed key. Deliberately no automatic
              // resubmit here; this only takes effect the next time the
              // user explicitly submits again.
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
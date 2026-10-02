import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiOutlineCalendarDays, HiOutlineChevronDown } from 'react-icons/hi2';
import './AddExpense.css';

import Spinner from '../alertsEffects/Spinner';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../alertsEffects/toastMessages';
import { useAddIncomeMutation } from '../../hooks/mutations/useAddIncomeMutation';
import { useSavedIncomeSources } from '../../hooks/queries/useSavedIncomeSources';

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

  // Source of Income suggestions: only this user's previously saved income
  // sources, in a menu styled like the Category Budgets category suggestions.
  // The field stays free text, so a new source can still be typed.
  const { sources: savedIncomeSources } = useSavedIncomeSources();
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [activeSourceIndex, setActiveSourceIndex] = useState(-1);
  const sourceFieldRef = useRef(null);
  const sourceInputRef = useRef(null);
  const sourceMenuRef = useRef(null);

  const typedSource = incomeSource.trim().toLocaleLowerCase();
  const matchingSources = savedIncomeSources.filter((source) =>
      source.toLocaleLowerCase().includes(typedSource)
  );

  const openSourceMenu = () => setSourceMenuOpen(true);

  const closeSourceMenu = useCallback(() => {
      setSourceMenuOpen(false);
      setActiveSourceIndex(-1);
  }, []);

  const selectSource = (source) => {
      setSource(source);
      sourceInputRef.current?.focus();
      closeSourceMenu();
  };

  // The chevron toggles the menu without taking focus from the input.
  const toggleSourceMenu = (e) => {
      e.preventDefault();
      if (sourceMenuOpen) {
          closeSourceMenu();
      } else {
          sourceInputRef.current?.focus();
          openSourceMenu();
      }
  };

  // A press anywhere outside the field and its menu closes the menu.
  useEffect(() => {
      if (!sourceMenuOpen) return undefined;
      const handleOutsidePointer = (event) => {
          if (!sourceFieldRef.current?.contains(event.target)) closeSourceMenu();
      };
      document.addEventListener('pointerdown', handleOutsidePointer);
      return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [sourceMenuOpen, closeSourceMenu]);

  // Keeps the highlighted option in view while arrowing through the list.
  useEffect(() => {
      if (!sourceMenuOpen || activeSourceIndex < 0) return;
      sourceMenuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [sourceMenuOpen, activeSourceIndex]);

  const handleSourceKeyDown = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openSourceMenu();
          if (matchingSources.length > 0) {
              setActiveSourceIndex((current) => event.key === 'ArrowDown'
                  ? (current + 1) % matchingSources.length
                  : (current <= 0 ? matchingSources.length - 1 : current - 1));
          }
      } else if (event.key === 'Enter' && sourceMenuOpen && matchingSources[activeSourceIndex]) {
          event.preventDefault(); // Picks the highlighted source instead of submitting.
          selectSource(matchingSources[activeSourceIndex]);
      } else if (event.key === 'Escape' || event.key === 'Tab' || event.key === 'Enter') {
          closeSourceMenu();
      }
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
        <div className="add-expense-wrapper add-income-page">
            <form className="add-expense" onSubmit={handleSubmit} aria-labelledby="add-income-title">
                <div className="add-income-header">
                    <h2 id="add-income-title" className="add-income-title">Add Income</h2>
                    <p className="add-income-subtitle">Record money coming into your account.</p>
                </div>

                <div className="field">
                    <label htmlFor="name">Source of Income<span className="add-income-required" aria-hidden="true">*</span></label>
                    <div className="add-income-select" ref={sourceFieldRef}>
                        <input
                            type="text"
                            value={incomeSource}
                            id="name"
                            ref={sourceInputRef}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-haspopup="listbox"
                            aria-expanded={sourceMenuOpen}
                            aria-controls={sourceMenuOpen ? 'add-income-source-menu' : undefined}
                            aria-activedescendant={sourceMenuOpen && matchingSources[activeSourceIndex]
                                ? `add-income-source-option-${activeSourceIndex}`
                                : undefined}
                            autoComplete="off"
                            onChange={(e) => {
                                setSource(e.target.value);
                                setActiveSourceIndex(-1);
                                openSourceMenu();
                            }}
                            onFocus={openSourceMenu}
                            onClick={openSourceMenu}
                            onKeyDown={handleSourceKeyDown}
                            placeholder="Salary, Scholarship, Freelance..."
                            required
                        />
                        <span className="add-income-select-icon" aria-hidden="true" onMouseDown={toggleSourceMenu}>
                            <HiOutlineChevronDown />
                        </span>
                        {sourceMenuOpen && (
                            <ul
                                id="add-income-source-menu"
                                ref={sourceMenuRef}
                                className="add-income-source-menu"
                                role="listbox"
                                aria-label="Saved income sources"
                            >
                                {matchingSources.length > 0 ? matchingSources.map((source, index) => (
                                    <li
                                        id={`add-income-source-option-${index}`}
                                        key={source}
                                        className="add-income-source-option"
                                        role="option"
                                        aria-selected={index === activeSourceIndex}
                                        onMouseEnter={() => setActiveSourceIndex(index)}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => selectSource(source)}
                                    >
                                        {source}
                                    </li>
                                )) : (
                                    <li className="add-income-source-empty" role="presentation">
                                        {savedIncomeSources.length > 0
                                            ? 'No matching sources \u2014 you can use your typed source.'
                                            : 'No saved sources yet'}
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="field">
                    <label htmlFor="number">Amount Received<span className="add-income-required" aria-hidden="true">*</span></label>
                    <div className="add-income-input-group">
                        <span className="add-income-input-addon" aria-hidden="true">₹</span>
                        <input
                            type="number"
                            value={incomeAmount}
                            id="number"
                            onChange={(e) => {setAmount(e.target.value)}}
                            placeholder="Enter amount"
                            min={0}
                            step="any"
                            required
                        />
                    </div>
                </div>

                <div className="field">
                    <label htmlFor="date">Date Received<span className="add-income-required" aria-hidden="true">*</span></label>
                    <div className="add-income-input-group add-income-input-group--date">
                        <input
                            type="date"
                            id="date"
                            value={incomeDate}
                            onChange={(e) => { setDate(e.target.value) }}
                            required
                        />
                        <span className="add-income-input-addon add-income-input-addon--end" aria-hidden="true">
                            <HiOutlineCalendarDays />
                        </span>
                    </div>
                </div>

                <button className="submit-btn" type="submit">
                  Add Income
                </button>
            </form>
        </div>
    </>
  )
}

export default AddIncome;
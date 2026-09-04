import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './AddExpense.css';

import Spinner from '../alertsEffects/Spinner';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../alertsEffects/toastMessages';

import BillUpload from '../billScanner/BillUpload';
import { forceReauth } from '../../api/handleApiError';
import { getExpenseEditData } from '../../api/expenseApi';
import { queryClient } from '../../query/queryClient';
import { queryKeys } from '../../query/queryKeys';
import { useAddExpenseMutation } from '../../hooks/mutations/useAddExpenseMutation';
import { useUpdateExpenseMutation } from '../../hooks/mutations/useUpdateExpenseMutation';
import { useSaveMerchantRuleMutation } from '../../hooks/mutations/useSaveMerchantRuleMutation';
import { getAccessToken } from '../../api/sessionClient';
import SaveRuleAlert from '../alertsEffects/SaveRuleAlert';
import { merchantRuleSaveSuccessToast, merchantRuleSaveErrorToast } from '../alertsEffects/toastMessages';

// Category Normalization -- moved to module scope (react-hooks/exhaustive-
const sanitizeText = (text = '') => {
    return text
        .trim()
        .replace(/\s+/g, ' ');
};

const normalizeCategory = (category = '') => {
    return sanitizeText(category)
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
};

// Expense creation/editing form with debounced ML category prediction and bill-scan/edit-load auto-fill.
const AddExpense = ({ isEdit, setIsEdit }) => {
    const [expenseName, setName] = useState('');
    const [expenseCategory, setCategory] = useState('');
    const [expenseAmount, setAmount] = useState('');
    const [expenseDate, setDate] = useState('');
    const [expenseDescription, setDescription] = useState('');
    const [isSpinnerLoading, setIsSpinnerLoading] = useState(false);
    const [isBillUpload, setIsBillUpload] = useState(false);
    const [billData, setBillData] = useState(null);

    const [mlLoading, setMlLoading] = useState(false);
    const [mlConfidence, setMlConfidence] = useState(null);
    const [mlPredictedCategory, setMlPredictedCategory] = useState('');

    // CAT-001-T05 -- set once a just-submitted expense's category diverged from the ML prediction; drives the post-submit "save this as a rule?" prompt.
    const [ruleSavePrompt, setRuleSavePrompt] = useState(null);

    // Tracks a programmatically-set expenseName (edit load / bill scan) so ML prediction doesn't run or overwrite the loaded category until the user actually types.
    const programmaticNameRef = useRef(null);

    // Phase C -- Expense Mutation Reliability: stable add-expense idempotency
    const addAttemptIdRef = useRef(null);
    const getAddAttemptId = () => {
        if (!addAttemptIdRef.current) {
            addAttemptIdRef.current =
                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        return addAttemptIdRef.current;
    };

    const navigate = useNavigate();

    const addExpenseMutation = useAddExpenseMutation();
    const updateExpenseMutation = useUpdateExpenseMutation();
    const saveMerchantRuleMutation = useSaveMerchantRuleMutation();

    // Debounced ML category prediction: skips programmatic name changes and short text, and cancels an in-flight prediction when superseded.
    useEffect(() => {
        if (programmaticNameRef.current === expenseName) {
            return;
        }
        programmaticNameRef.current = null;

        if (expenseName.trim().length < 3) {
            return;
        }

        const controller = new AbortController();

        const debounceTimer = setTimeout(async () => {
            try {
                setMlConfidence(null);
                setMlLoading(true);

                const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
                if (!BASE_URL) {
                    // Reuses the existing silent-failure path below via the catch block.
                    throw new Error("Missing backend URL");
                }
                const token = getAccessToken();

                const response = await fetch(`${BASE_URL}/ml/predict-category`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
                        },
                        body: JSON.stringify({expenseName: expenseName.trim()}),
                        signal: controller.signal
                    }
                );

                // A 429 here stays silent (no toast per keystroke); only 401 routes through the auth flow.
                if (response.status === 401) {
                    forceReauth();
                    return;
                }

                if (!response.ok) {
                    return;
                }

                const data = await response.json();
                console.log("ML Prediction:", data);

                if (data.predictedCategory) {
                    // Bugfix -- never clobber a category the user has already
                    // typed by the time this debounced prediction resolves.
                    // This used to unconditionally blank the field the moment
                    // the request started (`setCategory('')` above, now
                    // removed) and then unconditionally overwrite it here,
                    // regardless of anything the user typed into Category in
                    // the meantime. Filling Name then immediately filling
                    // Category (well within the 500ms debounce window) wiped
                    // out the just-typed Category value once this timer
                    // fired, leaving a required field empty with no visible
                    // error -- silently blocking submit via the browser's own
                    // native required-field validation. Only auto-fill when
                    // the user hasn't already put something there.
                    setCategory(prev => (prev.trim() === '' ? data.predictedCategory : prev));
                    setMlConfidence(data.confidence);
                    setMlPredictedCategory(data.predictedCategory);
                }

            } catch (err) {
                // An aborted request was superseded by a newer one — not an error.
                if (err.name === "AbortError") {
                    return;
                }
                console.log("ML Prediction Error:", err);
            } finally {
                setMlLoading(false);
            }
        }, 500);

        return () => {
            clearTimeout(debounceTimer);
            controller.abort();
        };
    }, [expenseName]);

    // Fetch Edit Expense
    useEffect(() => {
        const fetchEditExpense = async () => {
            setIsSpinnerLoading(true);

            try {
                // Routed through the query cache so a repeat edit-open within staleTime skips the network round-trip.
                const data = await queryClient.fetchQuery({
                    queryKey: queryKeys.expenses.detail(isEdit.expense_id),
                    queryFn: ({ signal }) => getExpenseEditData(isEdit.expense_id, signal),
                });

                if (data.data) {
                    const exp = data.data;
                    // Marks this name as programmatic so prediction doesn't overwrite the stored category being loaded.
                    programmaticNameRef.current = exp.expenseName || '';
                    setName(exp.expenseName || '');
                    // Category Normalization -- a historical expense's stored
                    setCategory(exp.expenseCategory ? normalizeCategory(exp.expenseCategory) : '');
                    setAmount(exp.expenseAmount || '');
                    setDate(exp.expenseDate?.split('T')[0] || '');
                    setDescription(exp.expenseDescription || '');
                } else {
                    console.error("Fetch failed:", data.message);
                }
            } catch (err) {
                // 401/429/409 are already surfaced by the shared axios interceptor — avoid a second error path.
                const status = err.response?.status;
                if (status !== 401 && status !== 429 && status !== 409) {
                    console.error("Fetch failed:", err.response?.data?.message || err.message);
                }
            } finally {
                setIsSpinnerLoading(false);
            }
        }
        if (isEdit.enableEdit && isEdit.expense_id) {
            fetchEditExpense();
        }
    }, [isEdit]);

    // Phase C -- Expense Mutation Reliability: entering edit mode is a
    useEffect(() => {
        if (isEdit.enableEdit) {
            addAttemptIdRef.current = null;
        }
    }, [isEdit.enableEdit]);

    // Handles form submission
    const handleSubmit = (e) => {
        e.preventDefault();
        setIsSpinnerLoading(true);

        // Hotfix -- `mlPredictedCategory && ...` short-circuits to the raw
        const wasMlCorrected = Boolean(mlPredictedCategory) && mlPredictedCategory !== normalizeCategory(expenseCategory);

        const payload = {
            expenseName: sanitizeText(expenseName),
            expenseCategory: normalizeCategory(expenseCategory),
            expenseAmount: +expenseAmount,
            expenseDate,
            expenseDescription: sanitizeText(expenseDescription),
            mlPredictedCategory,
            mlConfidence,
            wasMlCorrected
        };

        const mutationCallbacks = {
            onSuccess: (data) => {
                // Phase C -- Expense Mutation Reliability: a 2xx here always
                setName('');
                setCategory('');
                setAmount('');
                setDate('');
                setDescription('');
                // ML telemetry belongs to the expense just submitted — clear it so the next expense can't inherit a stale prediction.
                setMlPredictedCategory('');
                setMlConfidence(null);
                setIsEdit({ enableEdit: false, expense_id: '' });
                // Committed success: this add attempt is done, whether it was
                // a fresh create or a replay -- next submit is a new attempt.
                addAttemptIdRef.current = null;

                // CAT-001-T05 -- offer to remember this merchant's category only when the user actually overrode the ML prediction on THIS submit.
                if (wasMlCorrected) {
                    setRuleSavePrompt({ merchantName: payload.expenseName, category: payload.expenseCategory });
                }

                navigate('/');

                const toastData = data?.derivedData?.recoveryPending
                    ? { ...data, message: 'Expense saved. Budget and insights are still refreshing.' }
                    : data;
                expenseAddSuccessToast(toastData);
            },
            onError: (error) => {
                // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
                const status = error.response?.status;
                if (status === 401 || status === 429 || status === 409) {
                    return;
                }

                console.error("Expense submission error:", error);
                if (error.response?.data) {
                    expenseAddErrorToast(error.response.data);
                } else {
                    expenseAddErrorToast({ message: "Unexpected error occurred!" });
                }
            },
            onSettled: () => setIsSpinnerLoading(false),
        };

        if (!isEdit.enableEdit) {
            addExpenseMutation.mutate({ ...payload, id: getAddAttemptId() }, mutationCallbacks);
        } else {
            updateExpenseMutation.mutate({ editID: isEdit.expense_id, payload }, mutationCallbacks);
        }
    };

    // CAT-001-T05 -- persists the corrected category as a durable merchant rule; dismisses the prompt either way.
    const confirmSaveRuleHandler = () => {
        if (!ruleSavePrompt) return;

        saveMerchantRuleMutation.mutate(
            { merchantName: ruleSavePrompt.merchantName, category: ruleSavePrompt.category },
            {
                onSuccess: () => {
                    merchantRuleSaveSuccessToast();
                    setRuleSavePrompt(null);
                },
                onError: (error) => {
                    merchantRuleSaveErrorToast(error.response?.data);
                    setRuleSavePrompt(null);
                },
            }
        );
    };

    const cancelSaveRuleHandler = () => setRuleSavePrompt(null);

    useEffect(() => {
        if (billData) {
            // Marks this name as programmatic so prediction doesn't overwrite the category parsed from the receipt.
            programmaticNameRef.current = billData.expenseName || '';
            setName(billData.expenseName || '');
            setCategory(billData.expenseCategory || '');
            setAmount(billData.expenseAmount || '');
            setDate(billData.expenseDate ? billData.expenseDate.split('T')[0] : '');
            setDescription(billData.expenseDescription || '');
        }
    }, [billData]);

    if(isBillUpload) {
        return <BillUpload setIsBillUpload={setIsBillUpload} setBillData={setBillData} />
    }

    return (
    <>
    {isSpinnerLoading && <Spinner />}
        <div className="add-expense-wrapper">
            <form className="add-expense" onSubmit={handleSubmit}>
                <div className="field bill-upload-option">
                    <label>Do you want to upload a bill?</label>
                    <button className='open-bill-upload-btn' type="button" onClick={() => setIsBillUpload(true)}>
                        Upload
                    </button>
                </div>
                
                <div className="field">
                    <label htmlFor="name">Name of the Expense</label>
                    <input
                        type="text"
                        value={expenseName}
                        id="name"
                        onChange={(e) => {setName(e.target.value)}}
                        required
                    />
                </div>

                <div className="field category-input-wrapper">
                    <label htmlFor="category" className="category-label">
                        Category

                        {
                            mlConfidence && (
                                <span className="ml-confidence" aria-label={`ML confidence score: ${mlConfidence}%`}>
                                    <span>ML confidence</span>
                                    <strong>· {mlConfidence}%</strong>
                                </span>
                            )
                        }
                    </label>
                    <input
                        type="text"
                        value={expenseCategory}
                        id="category"
                        onChange={(e) => {setCategory(e.target.value)}}
                        maxLength={20}
                        required
                    />
                    {
                        mlLoading && (
                            <div className="ml-loading-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        )
                    }
                </div>

                <div className="field">
                    <label htmlFor="number">Amount Spent</label>
                    <input
                        type="number"
                        value={expenseAmount}
                        id="number"
                        onChange={(e) => {setAmount(e.target.value)}}
                        min={0}
                        step="any"
                        required
                    />
                </div>

                <div className="field">
                    <label htmlFor="date">Date Spent</label>
                    <input
                        type="date"
                        id="date"
                        value={expenseDate}
                        onChange={(e) => { setDate(e.target.value) }}
                        required
                    />
                </div>

                <div className="field">
                    <label htmlFor="description">Description <span className="optional-add">(optional)</span></label>
                    <input
                        type="text"
                        value={expenseDescription}
                        id="description"
                        onChange={(e) => {setDescription(e.target.value)}}
                        maxLength={25}
                    />
                </div>

                <button className="submit-btn" type="submit">
                    {isEdit.enableEdit ? "Update Expense" : "Add Expense"}
                </button>
            </form>
        </div>

        {ruleSavePrompt && (
            <SaveRuleAlert
                merchantName={ruleSavePrompt.merchantName}
                category={ruleSavePrompt.category}
                isSaving={saveMerchantRuleMutation.isPending}
                onConfirm={confirmSaveRuleHandler}
                onCancel={cancelSaveRuleHandler}
            />
        )}
    </>
    )
}

export default AddExpense;

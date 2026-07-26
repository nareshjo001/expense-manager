import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetContext } from '../contexts/BudgetContext';
import './AddExpense.css';

import Spinner from '../alertsEffects/Spinner';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../alertsEffects/toastMessages';

import BillUpload from '../billScanner/BillUpload';
import { forceReauth } from '../../api/handleApiError';

const AddExpense = ({ isEdit, setIsEdit }) => {
    // Local state hooks for form inputs
    const [expenseName, setName] = useState('');
    const [expenseCategory, setCategory] = useState('');
    const [expenseAmount, setAmount] = useState('');
    const [expenseDate, setDate] = useState('');
    const [expenseDescription, setDescription] = useState('');
    const [isSpinnerLoading, setIsSpinnerLoading] = useState(false);
    const [editID, setEditID] = useState('');
    const [isBillUpload, setIsBillUpload] = useState(false);
    const [billData, setBillData] = useState(null); // State to hold data extracted from bill upload

    const [mlLoading, setMlLoading] = useState(false);
    const [mlConfidence, setMlConfidence] = useState(null);
    const [mlPredictedCategory, setMlPredictedCategory] = useState('');

    const { fetchBudgets } = useContext(BudgetContext);
    const navigate = useNavigate(); // Hook to programmatically navigate to another route

    const sanitizeText = (text = '') => {
        return text
            .trim()                 // remove start/end spaces
            .replace(/\s+/g, ' '); // remove extra inner spaces
    };

    const normalizeCategory = (category = '') => {
        return sanitizeText(category)
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());
    };

    useEffect(() => {
        // DON'T CALL API FOR SHORT TEXT
        if (expenseName.trim().length < 3) {
            return;
        }

        // DEBOUNCE TIMER
        const debounceTimer = setTimeout(async () => {
            try {
                setCategory(''); // Clear category while loading new prediction
                setMlConfidence(null); // Clear confidence score
                setMlLoading(true);
                
                const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
                const token = localStorage.getItem("token");

                // This endpoint now requires authentication.
                const response = await fetch(`${BASE_URL}/ml/predict-category`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
                        },
                        body: JSON.stringify({expenseName: expenseName.trim()})
                    }
                );

                // Category prediction is an optional convenience, so a 429
                // here must stay silent rather than toasting on every
                // keystroke. A 401 still routes through the auth flow.
                if (response.status === 401) {
                    forceReauth();
                    return;
                }

                if (!response.ok) {
                    return;
                }

                const data = await response.json();
                console.log("ML Prediction:", data);

                // AUTO-FILL CATEGORY
                if (data.predictedCategory) {
                    setCategory(data.predictedCategory);
                    setMlConfidence(data.confidence);
                    setMlPredictedCategory(data.predictedCategory);
                }

            } catch (err) {
                console.log("ML Prediction Error:", err);
            } finally {
                setMlLoading(false);
            }
        }, 500);

        // CLEANUP FUNCTION
        return () => clearTimeout(debounceTimer);
    }, [expenseName]);

    // Fetch Edit Expense
    useEffect(() => {
        const fetchEditExpense = async () => {
            setIsSpinnerLoading(true);
            const token = localStorage.getItem("token");
            const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

            const response =  await fetch(`${BASE_URL}/expense/expense-edit-data?expenseId=${isEdit.expense_id}`, {
                method: 'GET',
                headers: {
                    'Content-Type' : 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok && data.data) {
                const exp = data.data;
                setEditID(exp._id);
                setName(exp.expenseName || '');
                setCategory(exp.expenseCategory || '');
                setAmount(exp.expenseAmount || '');
                setDate(exp.expenseDate?.split('T')[0] || '');
                setDescription(exp.expenseDescription || '');
                setIsSpinnerLoading(false);
            } else {
                setIsSpinnerLoading(false);
                console.error("Fetch failed:", data.message);
            }
        }
        if (isEdit.enableEdit && isEdit.expense_id) {
            fetchEditExpense();
        }
    }, [isEdit]);

    // Handles form submission
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSpinnerLoading(true);

        const token = localStorage.getItem("token");
        const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

        const wasMlCorrected = mlPredictedCategory && mlPredictedCategory !== normalizeCategory(expenseCategory);

        // Common payload structure
        const payload = {
            expenseName: sanitizeText(expenseName),
            expenseCategory: normalizeCategory(expenseCategory),
            expenseAmount: +expenseAmount,
            expenseDate,
            expenseDescription: sanitizeText(expenseDescription),

            // ML-related fields
            mlPredictedCategory,
            mlConfidence,
            wasMlCorrected
        };

        try {
        let response;

        if (!isEdit.enableEdit) {
            // ----------- ADD NEW EXPENSE -----------
            response = await fetch(`${BASE_URL}/expense/add-expense`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ ...payload, id: Date.now().toString() }),
            });
        } else {
            // ----------- EDIT EXISTING EXPENSE -----------
            response = await fetch(`${BASE_URL}/expense/update-expense?editID=${editID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            });
        }

        const data = await response.json();

        if (response.ok) {
            // Reset form and context
            setName('');
            setCategory('');
            setAmount('');
            setDate('');
            setDescription('');
            setIsEdit({ enableEdit: false, expense_id: '' });
            fetchBudgets();

            navigate('/'); // Go back to expense list
            expenseAddSuccessToast(data);
        } else {
            expenseAddErrorToast(data);
        }
        } catch (error) {
        console.error("Expense submission error:", error);
        expenseAddErrorToast({ message: "Unexpected error occurred!" });
        } finally {
        setIsSpinnerLoading(false);
        }
    };

    useEffect(() => {
        if (billData) {
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
                
                {/* Expense Name Input */}
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

                {/* Expense Category Input */}
                <div className="field category-input-wrapper">
                    <label htmlFor="category" className="category-label">
                        Category

                        {
                            mlConfidence && (
                                <span className="ml-confidence">
                                    ML Confidence Score : {mlConfidence}%
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

                {/* Expense Amount Input */}
                <div className="field">
                    <label htmlFor="number">Amount Spent</label>
                    <input
                        type="number"
                        value={expenseAmount}
                        id="number"
                        onChange={(e) => {setAmount(e.target.value)}}
                        min={0}
                        required
                    />
                </div>

                {/* Expense Date Input */}
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

                {/* Expense Description Input */}
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

                {/* Submit Button */}
                <button className="submit-btn" type="submit">
                    {isEdit.enableEdit ? "Update Expense" : "Add Expense"}
                </button>
            </form>
        </div>
    </>
    )
}

export default AddExpense;
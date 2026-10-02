import React, { useState, useRef, useLayoutEffect } from 'react';
import {
    FaTag,
    FaChevronDown,
    FaEdit,
    FaTrashAlt,
    FaUtensils,
    FaShoppingCart,
    FaReceipt,
    FaPlane,
    FaGamepad,
    FaMedkit,
    FaCoins,
    FaGraduationCap,
    FaWallet,
} from 'react-icons/fa';
import '../expensesHandling/AddExpense.css';
import './MerchantRules.css';

import QueryState from '../common/QueryState';
import DeleteAlert from '../alertsEffects/DeleteAlert';
import { useMerchantRulesQuery } from '../../hooks/queries/useMerchantRulesQuery';
import { useSaveMerchantRuleMutation } from '../../hooks/mutations/useSaveMerchantRuleMutation';
import { useDeleteMerchantRuleMutation } from '../../hooks/mutations/useDeleteMerchantRuleMutation';
import {
    merchantRuleSaveSuccessToast,
    merchantRuleSaveErrorToast,
    merchantRuleDeleteSuccessToast,
    merchantRuleDeleteErrorToast,
} from '../alertsEffects/toastMessages';

// Formats merchant for display: capitalizes the first letter of merchant names
const formatMerchantDisplay = (merchant = '') => {
    if (!merchant) return '';
    return merchant
        .trim()
        .split(/\s+/)
        .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
        .join(' ');
};

// Formats category for display: first word with its first letter capitalized
const formatCategoryDisplay = (category = '') => {
    if (!category) return '';
    const firstWord = category.trim().split(/\s+/)[0] || '';
    if (!firstWord) return '';
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
};

// Deterministic category to icon mapping so same category always gets the same consistent icon
const getCategoryIcon = (category = '') => {
    const value = category.trim().toLowerCase();
    if (value.includes('food') || value.includes('swiggy') || value.includes('zomato') || value.includes('dine') || value.includes('dining') || value.includes('restaurant') || value.includes('cafe') || value.includes('coffee') || value.includes('snack') || value.includes('eat')) {
        return FaUtensils;
    }
    if (value.includes('shop') || value.includes('grocer') || value.includes('mart') || value.includes('store') || value.includes('cloth') || value.includes('essential') || value.includes('supermarket') || value.includes('retail')) {
        return FaShoppingCart;
    }
    if (value.includes('bill') || value.includes('utilit') || value.includes('electric') || value.includes('water') || value.includes('recharge') || value.includes('subscript') || value.includes('rent') || value.includes('broadband') || value.includes('wifi') || value.includes('gas bill')) {
        return FaReceipt;
    }
    if (value.includes('travel') || value.includes('transport') || value.includes('flight') || value.includes('air') || value.includes('fuel') || value.includes('gas') || value.includes('petrol') || value.includes('diesel') || value.includes('cab') || value.includes('uber') || value.includes('ola') || value.includes('train') || value.includes('bus') || value.includes('metro')) {
        return FaPlane;
    }
    if (value.includes('entertain') || value.includes('movie') || value.includes('cinema') || value.includes('game') || value.includes('gaming') || value.includes('play') || value.includes('netflix') || value.includes('prime') || value.includes('hulu') || value.includes('disney') || value.includes('stream') || value.includes('music') || value.includes('spotify')) {
        return FaGamepad;
    }
    if (value.includes('health') || value.includes('medic') || value.includes('doctor') || value.includes('hospital') || value.includes('pharm') || value.includes('fitness') || value.includes('gym')) {
        return FaMedkit;
    }
    if (value.includes('invest') || value.includes('save') || value.includes('finance') || value.includes('bank') || value.includes('stock') || value.includes('mutual') || value.includes('crypto')) {
        return FaCoins;
    }
    if (value.includes('educat') || value.includes('exam') || value.includes('fee') || value.includes('fees') || value.includes('study') || value.includes('book') || value.includes('course') || value.includes('tuition') || value.includes('school') || value.includes('college') || value.includes('academy') || value.includes('training') || value.includes('university') || value.includes('learning')) {
        return FaGraduationCap;
    }
    return FaWallet;
};

const MAX_VISIBLE_SAVED_RULES = 5;

// CAT-001-T06 -- view/edit/delete the current user's saved merchant category
// rules. Backend CRUD (list/create/delete) already exists and is tested;
// this is the first frontend surface for it. `merchantKey` (not a separate
// display name) is what the backend stores, so it doubles as both the
// row's identity and the editable "merchant" field -- editing it re-saves
// under a NEW normalized key via upsert (the old key/rule is left as-is,
// same as typing a different merchant name ever would).
const MerchantRules = () => {
    const rulesQuery = useMerchantRulesQuery();
    const saveMutation = useSaveMerchantRuleMutation();
    const deleteMutation = useDeleteMerchantRuleMutation();

    const [merchantName, setMerchantName] = useState('');
    const [category, setCategory] = useState('');
    const [editingRuleId, setEditingRuleId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const rules = rulesQuery.data?.success ? rulesQuery.data.data : [];

    const formCardRef = useRef(null);

    const resetForm = () => {
        setMerchantName('');
        setCategory('');
        setEditingRuleId(null);
    };

    const startEdit = (rule) => {
        setEditingRuleId(rule._id);
        setMerchantName(rule.merchantKey);
        setCategory(rule.category);

        try {
            if (typeof formCardRef.current?.scrollIntoView === 'function') {
                formCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (_) {
            // Ignore environments without scroll implementations (e.g. JSDOM)
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!merchantName.trim() || !category.trim()) return;

        saveMutation.mutate(
            { merchantName: merchantName.trim(), category: category.trim() },
            {
                onSuccess: () => {
                    merchantRuleSaveSuccessToast();
                    resetForm();
                },
                onError: (error) => merchantRuleSaveErrorToast(error.response?.data),
            }
        );
    };

    const confirmDeleteHandler = () => {
        const ruleId = confirmDeleteId;
        deleteMutation.mutate(ruleId, {
            onSuccess: () => {
                merchantRuleDeleteSuccessToast();
                setConfirmDeleteId(null);
                // Editing the rule that was just deleted would silently re-create it on next save -- clear the form instead.
                if (editingRuleId === ruleId) resetForm();
            },
            onError: (error) => {
                merchantRuleDeleteErrorToast(error.response?.data);
                setConfirmDeleteId(null);
            },
        });
    };

    const listRef = useRef(null);

    useLayoutEffect(() => {
        if (!listRef.current) return;
        if (rules.length > MAX_VISIBLE_SAVED_RULES) {
            const items = listRef.current.querySelectorAll('.merchant-rules-item');
            if (items.length >= MAX_VISIBLE_SAVED_RULES) {
                const fifthItem = items[MAX_VISIBLE_SAVED_RULES - 1];
                const listRect = listRef.current.getBoundingClientRect();
                const fifthRect = fifthItem.getBoundingClientRect();
                const targetHeight = fifthRect.bottom - listRect.top;
                if (targetHeight > 0) {
                    listRef.current.style.maxHeight = `${Math.ceil(targetHeight) + 2}px`;
                    listRef.current.style.overflowY = 'auto';
                    return;
                }
            }
            listRef.current.style.maxHeight = '440px';
            listRef.current.style.overflowY = 'auto';
        } else {
            listRef.current.style.maxHeight = 'none';
            listRef.current.style.overflowY = 'visible';
        }
    }, [rules.length]);

    return (
        <div className="add-page merchant-rules-page">
            <div
                ref={formCardRef}
                className={`merchant-rules-card ${editingRuleId ? 'merchant-rules-card--editing' : ''}`}
            >
                <div className="merchant-rules-header">
                    <div className="merchant-rules-badge" aria-hidden="true">
                        <FaTag className="merchant-rules-badge-icon" />
                    </div>
                    <div className="merchant-rules-header-text">
                        <h2 className="merchant-rules-heading">Merchant Rules</h2>
                        <p className="merchant-rules-subheading">
                            Saved rules always win over the ML prediction for a matching merchant.
                        </p>
                    </div>
                </div>

                <form className="merchant-rules-form" onSubmit={handleSubmit}>
                    <div className="merchant-rules-fields-row">
                        <div className="field merchant-rules-field">
                            <label htmlFor="rule-merchant">Merchant</label>
                            <input
                                type="text"
                                id="rule-merchant"
                                value={merchantName}
                                onChange={(e) => setMerchantName(e.target.value)}
                                placeholder="Enter merchant name"
                                maxLength={200}
                                required
                            />
                        </div>

                        <div className="field merchant-rules-field">
                            <label htmlFor="rule-category">Category</label>
                            <div className="merchant-rules-select-wrapper">
                                <input
                                    type="text"
                                    id="rule-category"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    placeholder="Select category"
                                    maxLength={20}
                                    required
                                />
                                <span className="merchant-rules-select-arrow" aria-hidden="true">
                                    <FaChevronDown />
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="merchant-rules-form-actions">
                        <button className="submit-btn merchant-rules-submit-btn" type="submit" disabled={saveMutation.isPending}>
                            {saveMutation.isPending ? 'Saving…' : editingRuleId ? 'Update Rule' : 'Add Rule'}
                        </button>

                        {editingRuleId && (
                            <button type="button" className="merchant-rules-cancel-edit" onClick={resetForm}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="merchant-rules-saved-card">
                <div className="merchant-rules-saved-header">
                    <div className="merchant-rules-saved-title-wrap">
                        <span className="merchant-rules-saved-accent-bar" aria-hidden="true" />
                        <h3 className="merchant-rules-saved-title">Saved Rules</h3>
                    </div>
                    <p className="merchant-rules-saved-subtitle">
                        Automatically categorize and fill details for your recurring expenses.
                    </p>
                </div>

                <QueryState
                    isLoading={rulesQuery.isLoading}
                    isError={rulesQuery.isError}
                    isEmpty={!rulesQuery.isLoading && !rulesQuery.isError && rules.length === 0}
                    onRetry={rulesQuery.refetch}
                    loadingLabel="Loading your merchant rules..."
                    errorLabel="We couldn't load your merchant rules. Please try again."
                    emptyLabel="No merchant rules saved yet."
                    emptyHint="Correct a predicted category on the Add Expense page and choose to save it as a rule."
                >
                    <ul
                        ref={listRef}
                        className={`merchant-rules-list ${rules.length > MAX_VISIBLE_SAVED_RULES ? 'merchant-rules-list--scrollable' : ''}`}
                    >
                        {rules.map((rule) => {
                            const CategoryIcon = getCategoryIcon(rule.category);
                            return (
                                <li key={rule._id} className="merchant-rules-item">
                                    <div className="merchant-rules-item-left">
                                        <div className="merchant-rules-category-icon-badge" aria-hidden="true">
                                            <CategoryIcon />
                                        </div>
                                        <div className="merchant-rules-item-text">
                                            <span className="merchant-rules-item-merchant">
                                                {formatMerchantDisplay(rule.merchantKey)}
                                            </span>
                                            <span className="merchant-rules-item-category">
                                                {formatCategoryDisplay(rule.category)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="merchant-rules-item-actions">
                                        <button
                                            type="button"
                                            className="merchant-rules-btn-edit"
                                            onClick={() => startEdit(rule)}
                                        >
                                            <FaEdit className="merchant-rules-btn-icon" aria-hidden="true" />
                                            <span>Edit</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="merchant-rules-btn-delete"
                                            onClick={() => setConfirmDeleteId(rule._id)}
                                        >
                                            <FaTrashAlt className="merchant-rules-btn-icon" aria-hidden="true" />
                                            <span>Delete</span>
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </QueryState>
            </div>

            {confirmDeleteId && (
                <DeleteAlert
                    confirmDeleteId={confirmDeleteId}
                    confirmDeleteHandler={confirmDeleteHandler}
                    cancelDeleteHandler={() => setConfirmDeleteId(null)}
                    message="Are you sure you want to delete this merchant rule?"
                />
            )}
        </div>
    );
};

export default MerchantRules;

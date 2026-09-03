import React, { useState } from 'react';
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

    const resetForm = () => {
        setMerchantName('');
        setCategory('');
        setEditingRuleId(null);
    };

    const startEdit = (rule) => {
        setEditingRuleId(rule._id);
        setMerchantName(rule.merchantKey);
        setCategory(rule.category);
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

    return (
        <div className="add-page merchant-rules-page">
            <h2 className="merchant-rules-heading">Merchant Rules</h2>
            <p className="merchant-rules-subheading">
                Saved rules always win over the ML prediction for a matching merchant.
            </p>

            <form className="merchant-rules-form" onSubmit={handleSubmit}>
                <div className="field">
                    <label htmlFor="rule-merchant">Merchant</label>
                    <input
                        type="text"
                        id="rule-merchant"
                        value={merchantName}
                        onChange={(e) => setMerchantName(e.target.value)}
                        maxLength={200}
                        required
                    />
                </div>

                <div className="field">
                    <label htmlFor="rule-category">Category</label>
                    <input
                        type="text"
                        id="rule-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        maxLength={20}
                        required
                    />
                </div>

                <div className="merchant-rules-form-actions">
                    <button className="submit-btn" type="submit" disabled={saveMutation.isPending}>
                        {saveMutation.isPending ? 'Saving…' : editingRuleId ? 'Update Rule' : 'Add Rule'}
                    </button>

                    {editingRuleId && (
                        <button type="button" className="merchant-rules-cancel-edit" onClick={resetForm}>
                            Cancel
                        </button>
                    )}
                </div>
            </form>

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
                <ul className="merchant-rules-list">
                    {rules.map((rule) => (
                        <li key={rule._id} className="merchant-rules-item">
                            <div className="merchant-rules-item-text">
                                <span className="merchant-rules-item-merchant">{rule.merchantKey}</span>
                                <span className="merchant-rules-item-category">{rule.category}</span>
                            </div>

                            <div className="merchant-rules-item-actions">
                                <button type="button" onClick={() => startEdit(rule)}>Edit</button>
                                <button type="button" onClick={() => setConfirmDeleteId(rule._id)}>Delete</button>
                            </div>
                        </li>
                    ))}
                </ul>
            </QueryState>

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

import React from 'react';
import SetBudget from './SetBudget';
import CategoryBudgets from './CategoryBudgets';

// Dedicated route that composes the existing budget controls without
// duplicating their data, calculations, or interaction logic.
const BudgetsPage = () => (
  <div className="budgets-page-container">
    <div className="budgets-top-bar-card">
      <SetBudget />
    </div>
    <div className="category-budgets-parent-wrapper">
      <CategoryBudgets />
    </div>
  </div>
);

export default BudgetsPage;

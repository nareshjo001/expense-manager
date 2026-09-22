import React from 'react';
import './ExpenseFilterBar.css';

// EXP-002-T05 -- optional filter bar + active-filter chips for the custom-
// date-range search (GET /expense/search, validated by EXP-002-T02 and
// executed by EXP-002-T04's expenseSearchService). Purely additive: the
// mandatory startDate/endDate range stays owned by ExpensesPage's existing
// custom-range modal; this only exposes the four OPTIONAL filters
// EXP-002-T01's contract defined on top of that range --
// nameContains/category/minAmount/maxAmount/isRecurring, all AND-combined,
// every one of them genuinely optional (empty string here means "omit the
// param entirely", not "filter for empty/zero" -- matches the backend
// contract exactly, including isRecurring's third "Any" state being
// distinct from an explicit "false").
//
// `filters` is always the five-key string-valued shape ExpensesPage owns
// (see its `emptySearchFilters`); this component never parses/types them --
// that conversion (trim, Number(), boolean) happens once in ExpensesPage
// right before the API call, so this stays a plain controlled form.

const RECURRING_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Recurring only' },
  { value: 'false', label: 'One-time only' },
];

const FilterChip = ({ label, onRemove }) => (
  <span className="expense-filter-chip" role="listitem">
    <span className="expense-filter-chip-label">{label}</span>
    <button
      type="button"
      className="expense-filter-chip-remove"
      aria-label={`Remove filter: ${label}`}
      onClick={onRemove}
    >
      &times;
    </button>
  </span>
);

const ExpenseFilterBar = ({ filters, onChange, onClear }) => {
  const setField = (field, value) => {
    onChange({ ...filters, [field]: value });
  };

  const clearField = (field) => setField(field, '');

  const hasActiveFilters =
    Boolean(filters.nameContains.trim()) ||
    Boolean(filters.category.trim()) ||
    filters.minAmount !== '' ||
    filters.maxAmount !== '' ||
    filters.isRecurring !== '';

  return (
    <div className="expense-filter-bar" role="search" aria-label="Filter expenses">
      <div className="expense-filter-controls">
        <input
          type="text"
          className="expense-filter-input"
          placeholder="Search by name"
          aria-label="Search by expense name"
          value={filters.nameContains}
          onChange={(e) => setField('nameContains', e.target.value)}
        />

        <input
          type="text"
          className="expense-filter-input"
          placeholder="Category"
          aria-label="Filter by category"
          value={filters.category}
          onChange={(e) => setField('category', e.target.value)}
        />

        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="expense-filter-input expense-filter-input-amount"
          placeholder="Min amount"
          aria-label="Minimum amount"
          value={filters.minAmount}
          onChange={(e) => setField('minAmount', e.target.value)}
        />

        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="expense-filter-input expense-filter-input-amount"
          placeholder="Max amount"
          aria-label="Maximum amount"
          value={filters.maxAmount}
          onChange={(e) => setField('maxAmount', e.target.value)}
        />

        <select
          className="select-button filter-button expense-filter-recurring"
          aria-label="Filter by recurring status"
          value={filters.isRecurring}
          onChange={(e) => setField('isRecurring', e.target.value)}
        >
          {RECURRING_OPTIONS.map((option) => (
            <option key={option.value || 'any'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button type="button" className="expense-filter-clear" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="expense-filter-chips" role="list" aria-label="Active filters">
          {filters.nameContains.trim() && (
            <FilterChip label={`Name: ${filters.nameContains.trim()}`} onRemove={() => clearField('nameContains')} />
          )}
          {filters.category.trim() && (
            <FilterChip label={`Category: ${filters.category.trim()}`} onRemove={() => clearField('category')} />
          )}
          {filters.minAmount !== '' && (
            <FilterChip label={`Min: ${filters.minAmount}`} onRemove={() => clearField('minAmount')} />
          )}
          {filters.maxAmount !== '' && (
            <FilterChip label={`Max: ${filters.maxAmount}`} onRemove={() => clearField('maxAmount')} />
          )}
          {filters.isRecurring !== '' && (
            <FilterChip
              label={filters.isRecurring === 'true' ? 'Recurring only' : 'One-time only'}
              onRemove={() => clearField('isRecurring')}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ExpenseFilterBar;

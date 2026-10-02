import React, { useCallback, useEffect, useId, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import './CategoryBudgets.css';
import './CategoryBudgetsEmpty.css';
import './CategoryBudgetsList.css';
import '../../common/QueryState.css';
import QueryState from '../../common/QueryState';
// DAT-001-T06 -- all money renders through the shared formatter; the API
// sends integer paise, so formatMinor is used directly.
import { formatMinor, formatMoneyApprox } from '../../../utils/money';
import { useCategoryBudgetsQuery } from '../../../hooks/queries/useCategoryBudgetsQuery';
import { useSaveCategoryBudgetMutation } from '../../../hooks/mutations/useSaveCategoryBudgetMutation';
import { useDeleteCategoryBudgetMutation } from '../../../hooks/mutations/useDeleteCategoryBudgetMutation';
import {
  FaWallet,
  FaCoins,
  FaChartPie,
  FaChartLine,
  FaChartBar,
  FaUtensils,
  FaPlane,
  FaGamepad,
  FaShoppingCart,
  FaReceipt,
  FaPlus,
  FaCalendarAlt,
  FaChevronDown,
  FaChevronRight,
} from 'react-icons/fa';

// BUD-001-T05 -- per-category monthly budgets on top of (never replacing)
// the total monthly budget SetBudget manages. Every financial fact shown
// here (spent, remaining, status, projection, over-allocation) comes from
// the backend summary (docs/budgets/BUD-001-T01-category-budget-invariants.md
// section 3); this component only formats it.

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// Read-side bucket for invalid legacy data; the backend rejects budgeting it
// (RESERVED_CATEGORY), so it is never offered as a suggestion.
const RESERVED_CATEGORY = 'Uncategorized';

const STATUS_CLASS = {
  Safe: 'safe',
  Warning: 'warning',
  Critical: 'critical',
  Overspent: 'overspent',
};

// Display text for the backend status in the populated list. Only the
// wording of Safe changes ("On track", as in the reference design); the
// backend value is still what drives styling and the progress bar's
// accessible value text.
const STATUS_LABEL = {
  Safe: 'On track',
  Warning: 'Warning',
  Critical: 'Critical',
  Overspent: 'Overspent',
};

// Both panels list at most this many rows; further rows scroll inside the
// list, and a list with fewer rows is only as tall as its rows.
const MAX_VISIBLE_ROWS = 4;

// Caps a list at MAX_VISIBLE_ROWS rows. Rows can differ in height (an open
// budget row carries its details, long names wrap), so the window is
// measured rather than a fixed pixel height: it is exactly four rows tall --
// the first four, or the four ending at the open row (openRowClass) when
// that row sits further down. Re-measures whenever a row changes size.
const useVisibleRowCap = (listRef, deps, openRowClass) => {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    // Writes the cap only when it changes, so a re-fit that measures the
    // same height leaves the layout alone.
    const setMaxHeight = (value) => {
      if (list.style.maxHeight !== value) list.style.maxHeight = value;
    };

    const fit = () => {
      const rows = Array.from(list.children);
      if (rows.length <= MAX_VISIBLE_ROWS) {
        setMaxHeight('none');
        return null;
      }
      const openIndex = openRowClass
        ? rows.findIndex((row) => row.classList.contains(openRowClass))
        : -1;
      const start = openIndex >= MAX_VISIBLE_ROWS ? openIndex - MAX_VISIBLE_ROWS + 1 : 0;
      const top = rows[start].getBoundingClientRect().top;
      const bottom = rows[start + MAX_VISIBLE_ROWS - 1].getBoundingClientRect().bottom;
      const style = window.getComputedStyle(list);
      const height = bottom - top
        + (parseFloat(style.paddingTop) || 0)
        + (parseFloat(style.paddingBottom) || 0);
      // Without layout (e.g. jsdom) keep the stylesheet's fallback cap.
      setMaxHeight(height > 0 ? `${Math.ceil(height)}px` : '');
      return openIndex >= 0 ? rows[openIndex] : null;
    };

    // Keep a newly opened (or newly saved) row fully visible in the list.
    const openRow = fit();
    if (openRow) {
      const listBox = list.getBoundingClientRect();
      const rowBox = openRow.getBoundingClientRect();
      if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
      else if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    }

    if (typeof ResizeObserver === 'undefined') return undefined;
    // Re-fit on the next animation frame, not inside the observer callback:
    // changing the cap there can add or remove the page scrollbar, which
    // resizes every observed row again within the same frame, and the
    // browser then reports "ResizeObserver loop completed with undelivered
    // notifications". Any number of row resizes share one pending frame.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    });
    Array.from(list.children).forEach((row) => observer.observe(row));
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
};

// errorCode -> inline message. Codes from the T01 contract.
const ERROR_MESSAGES = {
  CATEGORY_BUDGET_EXCEEDS_TOTAL:
    'This would allocate more than your monthly total budget. Lower this amount, reduce another category, or raise the total budget.',
  TOO_MANY_CATEGORY_BUDGETS:
    "You've reached the maximum number of category budgets for this month. Remove one before adding another.",
  MONTH_NOT_WRITABLE:
    'This month is read-only, so its category budgets can no longer be changed.',
  RESERVED_CATEGORY:
    '"Uncategorized" can\'t have a budget. Choose a specific category.',
  INVALID_CATEGORY: 'Enter a category name (up to 50 characters).',
  INVALID_AMOUNT:
    'Enter an amount greater than zero, with at most 2 decimal places.',
  AMOUNT_OUT_OF_RANGE: 'That amount is too large for a category budget.',
  INVALID_MONTH: 'Choose a valid month.',
  CATEGORY_BUDGET_NOT_FOUND:
    'That category budget no longer exists. The list has been refreshed.',
  INVALID_ID:
    'That category budget no longer exists. The list has been refreshed.',
};

const currentMonthKey = () => format(new Date(), 'yyyy-MM');

const monthLabel = (monthKey) => {
  if (!monthKey || !MONTH_PATTERN.test(monthKey)) return '';
  const [year, month] = monthKey.split('-').map(Number);
  return format(new Date(year, month - 1, 1), 'MMMM yyyy');
};

const monthHeaderDisplay = (monthKey) => {
  if (!monthKey || !MONTH_PATTERN.test(monthKey)) return '';
  const [year, month] = monthKey.split('-').map(Number);
  return format(new Date(year, month - 1, 1), 'MMMM , yyyy');
};

// Integer paise -> the plain rupee string an amount input expects
// ("1500.00"), without going through float arithmetic.
const minorToInputValue = (minor) => {
  const rupees = Math.trunc(minor / 100);
  const paise = String(Math.abs(minor % 100)).padStart(2, '0');
  return `${rupees}.${paise}`;
};

const formatPercent = (value) =>
  `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;

// Maps a rejected mutation (or a 200 with success:false) to
// { message, field } for inline display. 401/429 are already handled by the
// shared axios interceptor (re-auth / toast), so nothing inline is added.
const describeError = (error) => {
  const response = error?.response;
  if (!response) {
    if (error && error.success === false) {
      return {
        message: ERROR_MESSAGES[error.errorCode] ?? error.message ?? "Couldn't save the category budget.",
        field: error.field,
      };
    }
    return { message: "Couldn't reach the server. Check your connection and try again." };
  }
  if (response.status === 401 || response.status === 429) return null;
  const body = response.data ?? {};
  return {
    message:
      ERROR_MESSAGES[body.errorCode] ??
      body.message ??
      'Something went wrong. Please try again.',
    field: body.field,
  };
};

const EMPTY_FORM = { category: '', amount: '' };
const NOTICE_DURATION_MS = 4000;

const categoryVisual = (category) => {
  const value = (category || '').toLowerCase();
  if (value.includes('bill')) return [FaReceipt, 'bills'];
  if (value.includes('food')) return [FaUtensils, 'food'];
  if (value.includes('entertain')) return [FaGamepad, 'play'];
  if (value.includes('essential') || value.includes('shop')) return [FaShoppingCart, 'shop'];
  if (value.includes('travel')) return [FaPlane, 'travel'];
  return [FaWallet, 'default'];
};

const CardCornerWave = ({ tone = 'pink' }) => (
  <div className={`category-budgets-card-wave category-budgets-card-wave--${tone}`} aria-hidden="true">
    <svg viewBox="0 0 140 80" fill="none" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 80 C35 70, 60 52, 90 56 C115 60, 128 35, 140 18 L140 80 Z"
        fill="currentColor"
      />
    </svg>
  </div>
);

const SparkleStar = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={`category-budgets-sparkle-star ${className}`}
    aria-hidden="true"
  >
    <path d="M12 0 Q12 12 24 12 Q12 12 12 24 Q12 12 0 12 Q12 12 12 0 Z" />
  </svg>
);

const PanelTopWave = () => (
  <div className="category-budgets-panel-wave-tr" aria-hidden="true">
    <svg viewBox="0 0 300 150" fill="none" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 0 C78 2, 105 53, 164 60 C222 67, 260 93, 300 150 L300 0 Z"
        fill="url(#cb-panel-tr-grad)"
      />
      <path
        d="M86 0 C154 8, 169 46, 222 39 C255 35, 274 14, 300 0 Z"
        fill="url(#cb-panel-tr-top-grad)"
      />
      <defs>
        <linearGradient id="cb-panel-tr-grad" x1="300" y1="0" x2="35" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#fbcfe8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#fdf2f8" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="cb-panel-tr-top-grad" x1="300" y1="0" x2="85" y2="65" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f9a8d4" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#fce7f3" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
    <div className="category-budgets-panel-sparkle">
      <SparkleStar />
      <SparkleStar className="category-budgets-sparkle-star--white category-budgets-sparkle-star--upper" />
      <SparkleStar className="category-budgets-sparkle-star--white category-budgets-sparkle-star--lower" />
    </div>
  </div>
);

const FormRightWave = () => (
  <div className="category-budgets-form-wave" aria-hidden="true">
    <svg viewBox="0 0 340 140" fill="none" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 75 C70 70, 115 30, 185 50 C245 68, 290 28, 340 10 L340 140 L0 140 Z"
        fill="url(#cb-form-wave-grad)"
      />
      <defs>
        <linearGradient id="cb-form-wave-grad" x1="340" y1="10" x2="60" y2="135" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.32" />
          <stop offset="60%" stopColor="#fbcfe8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fdf2f8" stopOpacity="0.02" />
        </linearGradient>
      </defs>
    </svg>
    <div className="category-budgets-form-sparkle">
      <SparkleStar />
      <SparkleStar className="category-budgets-sparkle-star--white category-budgets-sparkle-star--upper" />
      <SparkleStar className="category-budgets-sparkle-star--white category-budgets-sparkle-star--lower" />
    </div>
  </div>
);

const EmptyCategoryBudgetsArt = () => (
  <div className="category-budgets-empty-art-container" aria-hidden="true">
    <svg
      viewBox="0 0 460 270"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="category-budgets-empty-svg"
    >
      <defs>
        <radialGradient id="cb-empty-scene-halo">
          <stop className="cb-empty-halo-start" offset="0%" />
          <stop className="cb-empty-halo-end" offset="100%" />
        </radialGradient>
        <linearGradient id="cb-empty-board-fill" x1="155" y1="65" x2="305" y2="240" gradientUnits="userSpaceOnUse">
          <stop className="cb-empty-board-start" />
          <stop className="cb-empty-board-end" offset="100%" />
        </linearGradient>
        <linearGradient id="cb-empty-outline-fill" x1="150" y1="70" x2="310" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f9abd0" />
          <stop offset="100%" stopColor="#dc3f8d" />
        </linearGradient>
        <linearGradient id="cb-empty-clip-fill" x1="225" y1="48" x2="225" y2="81" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff91c2" />
          <stop offset="55%" stopColor="#f14b9a" />
          <stop offset="100%" stopColor="#c91968" />
        </linearGradient>
        <linearGradient id="cb-empty-line-fill" x1="190" y1="0" x2="285" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffa8d0" />
          <stop offset="100%" stopColor="#f274b1" />
        </linearGradient>
        <linearGradient id="cb-empty-plus-fill" x1="277" y1="192" x2="344" y2="259" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff81bc" />
          <stop offset="52%" stopColor="#e92b82" />
          <stop offset="100%" stopColor="#ac0753" />
        </linearGradient>
      </defs>
      <ellipse cx="230" cy="243" rx="178" ry="28" fill="url(#cb-empty-scene-halo)" />
      <circle className="cb-empty-cloud-back" cx="205" cy="145" r="105" />
      <circle className="cb-empty-cloud-back" cx="282" cy="149" r="94" />
      <circle className="cb-empty-cloud-front" cx="104" cy="225" r="48" />
      <circle className="cb-empty-cloud-front" cx="156" cy="226" r="54" />
      <circle className="cb-empty-cloud-front" cx="325" cy="221" r="58" />
      <circle className="cb-empty-cloud-front" cx="376" cy="228" r="45" />
      <path className="cb-empty-cloud-front" d="M72 235 Q139 177 203 225 Q270 181 337 231 L393 255 H61 Z" />
      <path className="cb-empty-art-sparkle" d="M106 150 Q106 162 119 163 Q106 164 106 177 Q104 164 92 163 Q104 162 106 150 Z" />
      <path className="cb-empty-art-sparkle" d="M359 65 Q359 78 372 79 Q359 80 359 93 Q357 80 345 79 Q357 78 359 65 Z" />
      <path className="cb-empty-art-sparkle cb-empty-art-sparkle--pale" d="M389 181 Q389 187 395 188 Q389 189 389 195 Q388 189 382 188 Q388 187 389 181 Z" />
      <rect x="151" y="66" width="160" height="177" rx="18" fill="url(#cb-empty-board-fill)" stroke="url(#cb-empty-outline-fill)" strokeWidth="7" />
      <rect x="193" y="53" width="76" height="28" rx="10" fill="url(#cb-empty-clip-fill)" />
      <circle cx="231" cy="54" r="13" fill="url(#cb-empty-clip-fill)" />
      <circle cx="231" cy="51" r="4" fill="#fff6fa" />
      <circle className="cb-empty-bullet" cx="189" cy="111" r="7" />
      <rect x="205" y="106" width="77" height="10" rx="5" fill="url(#cb-empty-line-fill)" />
      <circle className="cb-empty-bullet" cx="189" cy="145" r="7" />
      <rect x="205" y="140" width="77" height="10" rx="5" fill="url(#cb-empty-line-fill)" />
      <circle className="cb-empty-bullet" cx="189" cy="179" r="7" />
      <rect x="205" y="174" width="51" height="10" rx="5" fill="url(#cb-empty-line-fill)" />
      <circle cx="311" cy="212" r="35" fill="url(#cb-empty-plus-fill)" />
      <ellipse cx="299" cy="192" rx="14" ry="7" fill="#ffffff" fillOpacity="0.22" transform="rotate(-30 299 192)" />
      <path d="M311 196 V228 M295 212 H327" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  </div>
);

const EmptyPanelDecor = () => (
  <svg className="category-budgets-empty-decor" viewBox="0 0 900 500" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M-12 232 C26 89 98 104 158 76 C199 57 201 37 231 12" />
    <path d="M694 513 C734 448 792 467 842 421 C869 397 878 374 914 341" />
    <circle cx="54" cy="225" r="15" />
    <circle cx="846" cy="462" r="14" />
    <path className="category-budgets-empty-decor-star" d="M576 102 Q576 113 588 114 Q576 115 576 127 Q575 115 563 114 Q575 113 576 102 Z" />
    <path className="category-budgets-empty-decor-star" d="M330 209 Q330 216 338 217 Q330 218 330 225 Q329 218 322 217 Q329 216 330 209 Z" />
  </svg>
);

// Populated-list row: a collapsible summary (icon, name, "spent of budget",
// status, chevron) over a detail area holding the existing progress bar,
// figures, at-risk projection and Edit/Delete/confirm controls. Every value
// is the backend row formatted through formatMinor -- nothing is computed
// here beyond clamping the bar width.
const CategoryBudgetRow = ({
  row,
  writable,
  isExpanded,
  detailId,
  onToggle,
  isConfirmingDelete,
  isDeleting,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}) => {
  const [CategoryIcon, categoryTone] = categoryVisual(row.category);
  const statusClass = STATUS_CLASS[row.status] ?? 'safe';
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const barValue = Math.max(0, Math.min(Number(row.utilization) || 0, 100));
  const isOver = row.remainingMinor < 0;

  return (
    <li
      className={`category-budget-row category-budget-row--${statusClass}${isExpanded ? ' category-budget-row--expanded' : ''}`}
    >
      <button
        type="button"
        className="category-budget-summary"
        aria-expanded={isExpanded}
        aria-controls={detailId}
        onClick={() => onToggle(row.id)}
      >
        <span className={`category-budget-icon category-budget-icon--${categoryTone}`}>
          <CategoryIcon aria-hidden="true" />
        </span>
        <span className="category-budget-summary-text">
          <span className="category-budget-name">{row.category}</span>
          <span className="category-budget-summary-amounts">
            <span className="category-budget-summary-spent">
              <span className="category-budget-summary-amount-full">{formatMinor(row.spentMinor)}</span>
              <span className="category-budget-summary-amount-whole" aria-hidden="true">
                {formatMoneyApprox(undefined, row.spentMinor)}
              </span>
            </span>
            {' spent of '}
            <span className="category-budget-summary-budget">
              <span className="category-budget-summary-amount-full">{formatMinor(row.amountMinor)}</span>
              <span className="category-budget-summary-amount-whole" aria-hidden="true">
                {formatMoneyApprox(undefined, row.amountMinor)}
              </span>
            </span>
          </span>
        </span>
        <span className={`category-budget-status category-budget-status--${statusClass}`}>
          {statusLabel}
        </span>
        <span className="category-budget-chevron" aria-hidden="true">
          {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
        </span>
      </button>

      <div
        id={detailId}
        className="category-budget-detail"
        aria-hidden={!isExpanded}
        inert={!isExpanded}
      >
        <div className="category-budget-detail-content">
          <div
          className="category-budget-progress"
          role="progressbar"
          aria-label={`${row.category} budget used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barValue}
          aria-valuetext={`${formatPercent(row.utilization)} used, ${row.status}`}
          >
            <div
              className={`category-budget-progress-fill category-budget-progress-fill--${statusClass}`}
              style={{ width: `${barValue}%` }}
            />
          </div>

          <dl className="category-budget-figures">
            <div>
              <dt>Budget</dt>
              <dd>{formatMinor(row.amountMinor)}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>
                {formatMinor(row.spentMinor)} ({formatPercent(row.utilization)})
              </dd>
            </div>
            <div>
              <dt>{isOver ? 'Over by' : 'Remaining'}</dt>
              <dd className={isOver ? 'category-budget-over' : undefined}>
                {formatMinor(Math.abs(row.remainingMinor))}
              </dd>
            </div>
          </dl>

          {row.atRisk && (
            <p className="category-budget-at-risk">
              On pace to exceed this budget
              {typeof row.projectedSpentMinor === 'number' &&
                ` (projected ${formatMinor(row.projectedSpentMinor)} by month end)`}
              .
            </p>
          )}

          {writable && !isConfirmingDelete && (
            <div className="category-budget-actions">
              <button
                type="button"
                className="category-budget-button"
                onClick={() => onEdit(row)}
                aria-label={`Edit ${row.category} budget`}
              >
                Edit
              </button>
              <button
                type="button"
                className="category-budget-button category-budget-button--danger"
                onClick={() => onRequestDelete(row.id)}
                aria-label={`Delete ${row.category} budget`}
              >
                Delete
              </button>
            </div>
          )}

          {writable && isConfirmingDelete && (
            <div className="category-budget-confirm" role="group" aria-label={`Confirm deleting ${row.category} budget`}>
              <span>Delete the {row.category} budget?</span>
              <button
                type="button"
                className="category-budget-button category-budget-button--danger"
                onClick={() => onConfirmDelete(row)}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Confirm'}
              </button>
              <button
                type="button"
                className="category-budget-button"
                onClick={onCancelDelete}
                disabled={isDeleting}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

const CategoryBudgets = () => {
  const idPrefix = useId();
  const monthInputId = `${idPrefix}-month`;
  const categoryInputId = `${idPrefix}-category`;
  const amountInputId = `${idPrefix}-amount`;
  const suggestionsId = `${idPrefix}-suggestions`;
  const formErrorId = `${idPrefix}-form-error`;

  const [month, setMonth] = useState(currentMonthKey);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [listError, setListError] = useState(null);
  const [notice, setNotice] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [suggestionMenuPosition, setSuggestionMenuPosition] = useState(null);
  const categoryInputRef = useRef(null);
  const suggestionMenuRef = useRef(null);
  const amountInputRef = useRef(null);
  // Accordion: the id of the open row, or null when every row is collapsed
  // (the default).
  const [expandedId, setExpandedId] = useState(null);

  const query = useCategoryBudgetsQuery(month);
  const saveMutation = useSaveCategoryBudgetMutation();
  const deleteMutation = useDeleteCategoryBudgetMutation();

  const summary = query.data?.success ? query.data.data : null;
  const isError = query.isError || query.data?.success === false;
  const categories = summary?.categories ?? [];
  const unbudgeted = summary?.unbudgetedCategories ?? [];
  const totals = summary?.totals;
  const writable = summary?.writable === true;

  // Resolved during render: if the open row disappears (deleted, or a month
  // switch), every row is collapsed again.
  const openRowId =
    expandedId !== null && categories.some((c) => c.id === expandedId) ? expandedId : null;

  const toggleRow = (id) => {
    setExpandedId(openRowId === id ? null : id);
  };

  const budgetListRef = useRef(null);
  const unbudgetedListRef = useRef(null);
  useVisibleRowCap(budgetListRef, [categories, openRowId], 'category-budget-row--expanded');
  useVisibleRowCap(unbudgetedListRef, [unbudgeted]);

  // No canonical category list exists client-side (CAT-001 categories are
  // free text), so suggest the categories this month already has data for.
  const seenSuggestions = new Set();
  const suggestions = [...unbudgeted, ...categories]
    .map((c) => c.category)
    .filter((name) => {
      const key = name?.trim().toLocaleLowerCase();
      if (!key || key === RESERVED_CATEGORY.toLocaleLowerCase() || seenSuggestions.has(key)) return false;
      seenSuggestions.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
  const filteredSuggestions = suggestions.filter((name) =>
    name.toLocaleLowerCase().includes(form.category.trim().toLocaleLowerCase())
  );

  // Save/delete confirmations are transient feedback, not persistent page
  // content. Clear the current message and its timer on replacement/unmount.
  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const positionSuggestionMenu = useCallback(() => {
    const rect = categoryInputRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSuggestionMenuPosition({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(174, Math.max(0, rect.top - 14)),
    });
  }, []);

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
  }, []);

  const openSuggestions = () => {
    if (editingId) return;
    positionSuggestionMenu();
    setSuggestionsOpen(true);
  };

  const selectSuggestion = (name) => {
    setForm((current) => ({ ...current, category: name }));
    categoryInputRef.current?.focus();
    closeSuggestions();
  };

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    const handleOutsidePointer = (event) => {
      if (!categoryInputRef.current?.contains(event.target) &&
          !suggestionMenuRef.current?.contains(event.target)) {
        closeSuggestions();
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    window.addEventListener('resize', positionSuggestionMenu);
    window.addEventListener('scroll', positionSuggestionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      window.removeEventListener('resize', positionSuggestionMenu);
      window.removeEventListener('scroll', positionSuggestionMenu, true);
    };
  }, [suggestionsOpen, closeSuggestions, positionSuggestionMenu]);

  useEffect(() => {
    if (!suggestionsOpen || activeSuggestionIndex < 0) return;
    const activeOption = suggestionMenuRef.current?.querySelector('[aria-selected="true"]');
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [suggestionsOpen, activeSuggestionIndex]);

  const handleCategoryKeyDown = (event) => {
    if (editingId) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!suggestionsOpen) openSuggestions();
      if (filteredSuggestions.length > 0) {
        setActiveSuggestionIndex((current) => event.key === 'ArrowDown'
          ? (current + 1) % filteredSuggestions.length
          : (current < 0 ? filteredSuggestions.length - 1 : (current - 1 + filteredSuggestions.length) % filteredSuggestions.length));
      }
    } else if (event.key === 'Enter' && suggestionsOpen && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectSuggestion(filteredSuggestions[activeSuggestionIndex]);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      closeSuggestions();
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
    closeSuggestions();
  };

  const handleMonthChange = (e) => {
    const next = e.target.value;
    // Ignore partial/cleared input rather than issuing an INVALID_MONTH read.
    if (!MONTH_PATTERN.test(next)) return;
    setMonth(next);
    resetForm();
    setExpandedId(null);
    setConfirmingDeleteId(null);
    setListError(null);
    setNotice('');
  };

  const monthInputRef = useRef(null);

  const openMonthPicker = () => {
    if (monthInputRef.current) {
      if (typeof monthInputRef.current.showPicker === 'function') {
        try {
          monthInputRef.current.showPicker();
          return;
        } catch (err) {
          // Fall through
        }
      }
      monthInputRef.current.focus();
    }
  };

  const handleEdit = (row) => {
    closeSuggestions();
    setEditingId(row.id);
    setForm({ category: row.category, amount: minorToInputValue(row.amountMinor) });
    setFormError(null);
    setNotice('');
    // The form sits below the panels; bring it into view so the edit is
    // obvious. On narrow screens, do not focus the amount automatically:
    // that summons the virtual keyboard and obscures the field the user
    // needs to edit. Desktop retains its established focus behavior.
    requestAnimationFrame(() => {
      const input = amountInputRef.current;
      if (!input) return;
      input.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      const isMobileViewport = window.matchMedia?.('(max-width: 600px)').matches === true;
      if (!isMobileViewport) input.focus({ preventScroll: true });
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const category = form.category.trim();
    const amount = form.amount.trim();
    if (!category || !amount || saveMutation.isPending) return;

    setFormError(null);
    setNotice('');
    saveMutation.mutate(
      { month, category, amount },
      {
        onSuccess: (data) => {
          if (!data?.success) {
            setFormError(describeError(data));
            return;
          }
          const saved = data.data?.budget?.category ?? category;
          if (data.data?.budget?.id) setExpandedId(data.data.budget.id);
          setNotice(`Saved the ${saved} budget.`);
          resetForm();
        },
        onError: (error) => {
          setFormError(describeError(error));
        },
      }
    );
  };

  const handleConfirmDelete = (row) => {
    setListError(null);
    setNotice('');
    deleteMutation.mutate(
      { id: row.id, month },
      {
        onSuccess: (data) => {
          setConfirmingDeleteId(null);
          if (!data?.success) {
            setListError(describeError(data));
            return;
          }
          if (editingId === row.id) resetForm();
          setNotice(`Deleted the ${row.category} budget.`);
        },
        onError: (error) => {
          setConfirmingDeleteId(null);
          setListError(describeError(error));
        },
      }
    );
  };

  const isFormIncomplete = !form.category.trim() || !form.amount.trim();

  const suggestionMenu = suggestionsOpen && !editingId && suggestionMenuPosition && createPortal(
    <ul
      id={suggestionsId}
      ref={suggestionMenuRef}
      className="category-budgets-suggestion-menu"
      role="listbox"
      aria-label="Category suggestions"
      style={suggestionMenuPosition}
    >
      {filteredSuggestions.length > 0 ? filteredSuggestions.map((name, index) => (
        <li
          id={`${suggestionsId}-option-${index}`}
          key={name}
          className="category-budgets-suggestion-option"
          role="option"
          aria-selected={index === activeSuggestionIndex}
          onMouseEnter={() => setActiveSuggestionIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectSuggestion(name)}
        >
          {name}
        </li>
      )) : (
        <li className="category-budgets-suggestion-empty" role="presentation">
          No matching suggestions — you can use your typed category.
        </li>
      )}
    </ul>,
    document.body
  );

  const renderTotals = () => (
    <div className="category-budgets-summary-section">
      <div className="category-budgets-summary-cards">
        {/* Card 1: Total Budget */}
        <div className="category-budgets-summary-card category-budgets-summary-card--total">
          <div className="category-budgets-stat-icon-wrap category-budgets-stat-icon-wrap--pink">
            <FaWallet aria-hidden="true" />
          </div>
          <div className="category-budgets-stat-info">
            <span className="category-budgets-stat-label">Total Budget</span>
            <strong className="category-budgets-stat-value">
              {totals.totalBudgetMinor === null ? 'Not set' : formatMinor(totals.totalBudgetMinor)}
            </strong>
          </div>
          <CardCornerWave tone="pink" />
        </div>

        {/* Card 2: Allocated */}
        <div className="category-budgets-summary-card category-budgets-summary-card--allocated">
          <div className="category-budgets-stat-icon-wrap category-budgets-stat-icon-wrap--purple">
            <FaCoins aria-hidden="true" />
          </div>
          <div className="category-budgets-stat-info">
            <span className="category-budgets-stat-label">Allocated</span>
            <strong className="category-budgets-stat-value">
              {formatMinor(totals.allocatedMinor)}
            </strong>
          </div>
          <CardCornerWave tone="purple" />
        </div>

        {/* Card 3: Unallocated */}
        <div className="category-budgets-summary-card category-budgets-summary-card--unallocated">
          <div className="category-budgets-stat-icon-wrap category-budgets-stat-icon-wrap--coral">
            <FaChartPie aria-hidden="true" />
          </div>
          <div className="category-budgets-stat-info">
            <span className="category-budgets-stat-label">Unallocated</span>
            <strong className="category-budgets-stat-value">
              {totals.totalBudgetMinor === null
                ? 'Set a total budget'
                : totals.overAllocated
                  ? 'Over-allocated'
                  : formatMinor(totals.unallocatedMinor)}
            </strong>
            {!totals.overAllocated && typeof totals.unallocatedMinor === 'number' && totals.unallocatedMinor > 0 && (
              <span className="sr-only"> ({formatMinor(totals.unallocatedMinor)} unallocated)</span>
            )}
          </div>
          <CardCornerWave tone="coral" />
        </div>

        {/* Card 4: Unbudgeted Spending */}
        <div className="category-budgets-summary-card category-budgets-summary-card--unbudgeted">
          <div className="category-budgets-stat-icon-wrap category-budgets-stat-icon-wrap--pink">
            <FaChartLine aria-hidden="true" />
          </div>
          <div className="category-budgets-stat-info">
            <span className="category-budgets-stat-label">Unbudgeted Spending</span>
            <strong className="category-budgets-stat-value">
              {formatMinor(totals.unbudgetedSpentMinor)}
            </strong>
          </div>
          <CardCornerWave tone="pink" />
        </div>
      </div>

      {totals.totalBudgetMinor === null && (
        <p className="category-budgets-note category-budgets-no-total-note">
          No monthly total budget is set for this month. Category budgets still work on their own.
        </p>
      )}

      {totals.overAllocated && (
        <p className="category-budgets-warning" role="alert">
          Warning: over-allocated by {formatMinor(totals.overAllocatedByMinor)}. Your category
          budgets add up to more than this month&apos;s total budget. Lower some category budgets
          or raise the total.
        </p>
      )}
    </div>
  );

  const renderForm = () => (
    <div className="category-budgets-form-card">
      <FormRightWave />

      <div className="category-budgets-form-header">
        <div className="category-budgets-form-badge" aria-hidden="true">
          <FaPlus />
        </div>
        <div className="category-budgets-form-header-text">
          <h3 className="category-budgets-form-title">
            {editingId ? 'Edit category budget' : 'Add a new category budget'}
          </h3>
          <p className="category-budgets-form-subtitle">
            Set a monthly limit for a category to track it separately from your overall budget.
          </p>
        </div>
      </div>

      <form
        className="category-budgets-form"
        onSubmit={handleSubmit}
        aria-label={editingId ? 'Edit category budget' : 'Add category budget'}
        noValidate
      >
        <div className="category-budgets-form-row">
          <div className="category-budgets-field category-budgets-field--category">
            <label htmlFor={categoryInputId}>Category</label>
            <div className="category-budgets-input-wrapper">
              <input
                id={categoryInputId}
                ref={categoryInputRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={suggestionsOpen && !editingId}
                aria-controls={suggestionsOpen && !editingId ? suggestionsId : undefined}
                aria-activedescendant={suggestionsOpen && activeSuggestionIndex >= 0 && filteredSuggestions[activeSuggestionIndex]
                  ? `${suggestionsId}-option-${activeSuggestionIndex}`
                  : undefined}
                value={form.category}
                placeholder="Select a category"
                maxLength={50}
                readOnly={Boolean(editingId)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, category: e.target.value }));
                  setActiveSuggestionIndex(-1);
                  openSuggestions();
                }}
                onFocus={openSuggestions}
                onKeyDown={handleCategoryKeyDown}
                aria-invalid={formError?.field === 'category' ? true : undefined}
                aria-describedby={formError ? formErrorId : undefined}
                required
              />
              <FaChevronDown className="category-budgets-field-chevron" aria-hidden="true" />
            </div>
          </div>

          <div className="category-budgets-field category-budgets-field--amount">
            <label htmlFor={amountInputId}>Amount (₹)</label>
            <div className="category-budgets-input-wrapper category-budgets-input-wrapper--amount">
              <span className="category-budgets-currency-symbol" aria-hidden="true">₹</span>
              <input
                id={amountInputId}
                ref={amountInputRef}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                placeholder="Enter amount"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                aria-invalid={formError?.field === 'amount' ? true : undefined}
                aria-describedby={formError ? formErrorId : undefined}
                required
              />
            </div>
          </div>

          <div className={`category-budgets-form-actions${editingId ? ' category-budgets-form-actions--editing' : ''}`}>
            <button
              type="submit"
              className="category-budget-button category-budget-button--submit"
              aria-label={editingId ? 'Update budget' : 'Add Budget'}
              disabled={saveMutation.isPending || isFormIncomplete}
            >
              <span className="category-budget-button-plus" aria-hidden="true">
                <FaPlus />
              </span>
              <span className="category-budget-button-label--desktop" aria-hidden="true">
                {saveMutation.isPending
                  ? 'Saving...'
                  : editingId
                    ? 'Update budget'
                    : 'Add Budget'}
              </span>
              {editingId && <span className="category-budget-button-label--mobile" aria-hidden="true">Update</span>}
            </button>
            {editingId && (
              <button
                type="button"
                className="category-budget-button category-budget-button--cancel"
                onClick={resetForm}
                disabled={saveMutation.isPending}
                aria-label="Cancel edit"
              >
                <span className="category-budget-button-label--desktop" aria-hidden="true">Cancel edit</span>
                <span className="category-budget-button-label--mobile" aria-hidden="true">Cancel</span>
              </button>
            )}
          </div>
        </div>

        {formError && (
          <p id={formErrorId} className="category-budgets-error" role="alert">
            {formError.message}
          </p>
        )}
      </form>
      {suggestionMenu}
    </div>
  );

  return (
    <section className="category-budgets" aria-labelledby={`${idPrefix}-heading`}>
      <div className="category-budgets-header">
        <div className="category-budgets-heading-group">
          <div className="category-budgets-title-wrapper">
            <span className="category-budgets-title-bar" aria-hidden="true" />
            <h2 id={`${idPrefix}-heading`}>Category Budgets</h2>
          </div>
          {summary?.rolloverPolicy === 'none' && (
            <p className="category-budgets-rollover-subtitle">
              Unspent amounts don&apos;t carry over to next month.
            </p>
          )}
        </div>

        <div className="category-budgets-month">
          <label htmlFor={monthInputId}>Month</label>
          <div
            className="category-budgets-month-control"
            onClick={openMonthPicker}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openMonthPicker();
              }
            }}
            aria-label={`Select month, currently ${monthHeaderDisplay(month)}`}
          >
            <FaCalendarAlt className="category-budgets-month-icon" aria-hidden="true" />
            <span className="category-budgets-month-display">
              {monthHeaderDisplay(month)}
            </span>
            <FaChevronDown className="category-budgets-month-chevron" aria-hidden="true" />
            <input
              ref={monthInputRef}
              id={monthInputId}
              type="month"
              value={month}
              onChange={handleMonthChange}
              onClick={(e) => {
                if (typeof e.target.showPicker === 'function') {
                  try {
                    e.target.showPicker();
                  } catch (err) {}
                }
              }}
              className="category-budgets-month-native-input"
              aria-label="Month"
            />
          </div>
        </div>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={isError}
        onRetry={() => query.refetch()}
        loadingLabel="Loading category budgets..."
        errorLabel="Couldn't load category budgets."
      >
        {summary && totals && (
          <>
            {!writable && (
              <p className="category-budgets-note category-budgets-readonly">
                {monthLabel(summary.month ?? month)} is read-only. Category budgets can only be changed
                for the current month and upcoming months.
              </p>
            )}

            {renderTotals()}

            {notice && (
              <p className="category-budgets-notice" role="status">
                {notice}
              </p>
            )}

            {listError && (
              <p className="category-budgets-error" role="alert">
                {listError.message}
              </p>
            )}

            <div className={`category-budgets-panels${categories.length > 0 ? ' category-budgets-panels--list' : ''}`}>
              {/* Left Panel: Category Budgets or Illustrated Empty State */}
              <div className={`category-budgets-panel category-budgets-panel--left${categories.length === 0 ? ' category-budgets-panel--empty' : ' category-budgets-panel--list'}`}>
                <CardCornerWave />
                {categories.length === 0 ? (
                  <>
                    <EmptyPanelDecor />
                    <div className="category-budgets-empty">
                      <EmptyCategoryBudgetsArt />
                      <h3 className="category-budgets-empty-title">
                        No category budgets set.
                      </h3>
                      {writable && (
                        <p className="category-budgets-empty-subtitle">
                          Give a category like Food or Travel its own limit to track it separately from
                          your overall budget.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="category-budgets-list-header">
                      <div className="category-budgets-list-icon" aria-hidden="true">
                        <FaChartBar />
                      </div>
                      <div className="category-budgets-list-header-text">
                        <h3 className="category-budgets-list-title">Category Budgets</h3>
                        <p className="category-budgets-list-subtitle">
                          {writable
                            ? 'Tap a category to view details and actions.'
                            : 'Tap a category to view details.'}
                        </p>
                      </div>
                    </div>
                  <ul ref={budgetListRef} className="category-budgets-list" aria-label="Category budgets">
                    {categories.map((row) => (
                      <CategoryBudgetRow
                        key={row.id}
                        row={row}
                        writable={writable}
                        isExpanded={openRowId === row.id}
                        detailId={`${idPrefix}-budget-${row.id}`}
                        onToggle={toggleRow}
                        isConfirmingDelete={confirmingDeleteId === row.id}
                        isDeleting={deleteMutation.isPending}
                        onEdit={handleEdit}
                        onRequestDelete={setConfirmingDeleteId}
                        onCancelDelete={() => setConfirmingDeleteId(null)}
                        onConfirmDelete={handleConfirmDelete}
                      />
                    ))}
                  </ul>
                  </>
                )}
              </div>

              {/* Right Panel: Unbudgeted Categories */}
              <div className="category-budgets-panel category-budgets-panel--right">
                <PanelTopWave />

                <div className="category-budgets-panel-header">
                  <div className="category-budgets-panel-icon-wrap" aria-hidden="true">
                    <FaChartBar />
                  </div>
                  <div className="category-budgets-panel-header-text">
                    <h3
                      className="category-budgets-panel-title"
                      aria-label={`Unbudgeted categories. Unbudgeted spending: ${formatMinor(totals.unbudgetedSpentMinor)}`}
                    >
                      Unbudgeted categories
                    </h3>
                    <p className="category-budgets-panel-subtitle">
                      These are part of your unbudgeted spending ({formatMinor(totals.unbudgetedSpentMinor)}).
                    </p>
                  </div>
                </div>

                {unbudgeted.length > 0 ? (
                  <ul
                    ref={unbudgetedListRef}
                    className="category-budgets-unbudgeted-list"
                    aria-label="Unbudgeted spending by category"
                  >
                    {unbudgeted.map((c) => {
                      const [Icon, tone] = categoryVisual(c.category);
                      return (
                        <li key={c.category} className="category-budgets-unbudgeted-item">
                          <span className={`category-budget-icon category-budget-icon--${tone}`}>
                            <Icon aria-hidden="true" />
                          </span>
                          <span className="category-budgets-unbudgeted-name">{c.category}</span>
                          <strong className="category-budgets-unbudgeted-amount">{formatMinor(c.spentMinor)}</strong>
                          <span className="sr-only">{c.category}: {formatMinor(c.spentMinor)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="category-budgets-unbudgeted-empty">
                    <p className="category-budgets-note">No unbudgeted spending for this month.</p>
                  </div>
                )}
              </div>
            </div>

            {writable && renderForm()}
          </>
        )}
      </QueryState>
    </section>
  );
};

export default CategoryBudgets;

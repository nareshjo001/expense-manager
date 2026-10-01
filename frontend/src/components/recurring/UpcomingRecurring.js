import React, { useState } from "react";
import { format, parseISO } from "date-fns";
// DAT-001-T06 -- all money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import { FormStatus } from "../a11y/FormStatus";
import { useUpcomingRecurringQuery } from "../../hooks/queries/useUpcomingRecurringQuery";
import { useSkipRecurringMutation } from "../../hooks/mutations/useSkipRecurringMutation";
import {
  recurringActionSuccessToast,
  recurringActionErrorToast,
} from "../alertsEffects/toastMessages";
import {
  FaBolt,
  FaUtensils,
  FaShoppingCart,
  FaPlane,
  FaGamepad,
  FaMedkit,
  FaHome,
  FaCoins,
  FaGraduationCap,
} from "react-icons/fa";
import "./UpcomingRecurring.css";

// REC-003-T04 -- the upcoming recurring expenses view.
// REC-003-T03 -- its empty, error and stale states.
//
// T03 is listed as its own task and treated as one here, because the three
// states it names are the ones a list component usually gets wrong by
// collapsing them:
//
//   EMPTY   "you have no recurring expenses" and "your recurring expenses
//           produce nothing in this window" are different facts. The first
//           is answered by setting one up; the second by looking further
//           ahead. Rendering one blank panel for both tells the user nothing.
//
//   ERROR   a failed request must not render as an empty schedule. "No
//           upcoming expenses" when the request actually 500'd is a lie the
//           user may plan around, and it is the single most common way a
//           list component misleads.
//
//   STALE   this is a PROJECTION of what a cron job will do. If that job has
//           not run, occurrences are overdue and the projection's dates are
//           already wrong in a way the user needs told. The server reports
//           overdueCount for exactly this, and the panel surfaces it rather
//           than quietly listing past dates as though they were upcoming.
//
// Pure Forecast Projection View:
//   This section renders a clean 3-month forecast of upcoming recurring
//   expenses. Master lifecycle controls (Edit, Pause, Resume, End) belong
//   exclusively to the Master Section (RecurringManagement.js).

const STATUS = {
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
};

// Groups occurrences by their calendar month for display. The server already
// sorted them by due date, so a single pass preserves that order.
function groupByMonth(occurrences) {
  const groups = [];
  let current = null;

  for (const occurrence of occurrences) {
    // dueCalendarDate is the date in the app's configured time zone -- NOT
    // derived from the ISO instant here. Formatting the instant locally would
    // reintroduce the off-by-one-day bug for any viewer west of UTC, which is
    // the whole reason the server sends this field.
    const monthKey = occurrence.dueCalendarDate.slice(0, 7);
    if (!current || current.monthKey !== monthKey) {
      current = { monthKey, occurrences: [] };
      groups.push(current);
    }
    current.occurrences.push(occurrence);
  }

  return groups;
}

function monthLabel(monthKey) {
  // monthKey is YYYY-MM; parse as a date-only value so no time zone shift
  // applies to a label that has no time component.
  return format(parseISO(`${monthKey}-01`), "MMMM yyyy");
}

// Maps expense name and category to matching visual icon
const getRecurringIcon = (name = "", category = "") => {
  const combined = `${name} ${category}`.trim().toLowerCase();
  if (
    combined.includes("recharge") ||
    combined.includes("electric") ||
    combined.includes("power") ||
    combined.includes("broadband") ||
    combined.includes("wifi") ||
    combined.includes("phone") ||
    combined.includes("mobile") ||
    combined.includes("bill") ||
    combined.includes("utilit")
  ) {
    return FaBolt;
  }
  if (
    combined.includes("food") ||
    combined.includes("swiggy") ||
    combined.includes("zomato") ||
    combined.includes("dine") ||
    combined.includes("dining") ||
    combined.includes("restaurant") ||
    combined.includes("grocer") ||
    combined.includes("snack") ||
    combined.includes("eat") ||
    combined.includes("cafe")
  ) {
    return FaUtensils;
  }
  if (
    combined.includes("shop") ||
    combined.includes("mart") ||
    combined.includes("store") ||
    combined.includes("cloth") ||
    combined.includes("essential") ||
    combined.includes("supermarket") ||
    combined.includes("retail")
  ) {
    return FaShoppingCart;
  }
  if (
    combined.includes("travel") ||
    combined.includes("transport") ||
    combined.includes("flight") ||
    combined.includes("air") ||
    combined.includes("fuel") ||
    combined.includes("gas") ||
    combined.includes("petrol") ||
    combined.includes("diesel") ||
    combined.includes("cab") ||
    combined.includes("uber") ||
    combined.includes("ola") ||
    combined.includes("train") ||
    combined.includes("bus") ||
    combined.includes("metro")
  ) {
    return FaPlane;
  }
  if (
    combined.includes("entertain") ||
    combined.includes("movie") ||
    combined.includes("cinema") ||
    combined.includes("game") ||
    combined.includes("gaming") ||
    combined.includes("play") ||
    combined.includes("netflix") ||
    combined.includes("prime") ||
    combined.includes("stream") ||
    combined.includes("music") ||
    combined.includes("spotify")
  ) {
    return FaGamepad;
  }
  if (
    combined.includes("health") ||
    combined.includes("medic") ||
    combined.includes("doctor") ||
    combined.includes("hospital") ||
    combined.includes("pharm") ||
    combined.includes("fitness") ||
    combined.includes("gym")
  ) {
    return FaMedkit;
  }
  if (
    combined.includes("rent") ||
    combined.includes("hous") ||
    combined.includes("home") ||
    combined.includes("flat") ||
    combined.includes("apartment")
  ) {
    return FaHome;
  }
  if (
    combined.includes("invest") ||
    combined.includes("save") ||
    combined.includes("finance") ||
    combined.includes("bank") ||
    combined.includes("stock") ||
    combined.includes("mutual") ||
    combined.includes("crypto")
  ) {
    return FaCoins;
  }
  if (
    combined.includes("educat") ||
    combined.includes("exam") ||
    combined.includes("fee") ||
    combined.includes("study") ||
    combined.includes("book") ||
    combined.includes("course") ||
    combined.includes("tuition") ||
    combined.includes("school") ||
    combined.includes("college") ||
    combined.includes("learning")
  ) {
    return FaGraduationCap;
  }
  return FaBolt;
};

const UpcomingRecurring = () => {
  const {
    data: payload,
    isLoading,
    isError,
    error,
    refetch,
  } = useUpcomingRecurringQuery();

  const [confirmSkipOccurrence, setConfirmSkipOccurrence] = useState(null);
  const skipMutation = useSkipRecurringMutation();

  const handleSkipConfirm = () => {
    if (!confirmSkipOccurrence) return;
    const target = confirmSkipOccurrence;
    skipMutation.mutate(
      {
        id: target.recurringId,
        date: target.dueCalendarDate,
        scheduleVersion: target.scheduleVersion,
      },
      {
        onSuccess: () => {
          const monthName = format(parseISO(target.dueCalendarDate), "MMMM yyyy");
          recurringActionSuccessToast(`Skipped ${target.expenseName} for ${monthName}.`);
          setConfirmSkipOccurrence(null);
        },
        onError: (err) => {
          recurringActionErrorToast(err?.response?.data);
          setConfirmSkipOccurrence(null);
        },
      }
    );
  };

  const isCanceled = error?.name === "CanceledError" || error?.name === "AbortError";
  const isActualError = isError && !isCanceled;

  if (isLoading || (isError && isCanceled)) {
    return (
      <section className="upcoming-recurring upcoming-recurring--loading" aria-busy="true">
        <div className="upcoming-recurring__header">
          <div className="upcoming-recurring__title-wrapper">
            <span className="upcoming-recurring__accent-bar" aria-hidden="true" />
            <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
          </div>
        </div>
        <p className="upcoming-recurring__muted">Loading…</p>
      </section>
    );
  }

  // ERROR -- deliberately not rendered as an empty list. See the header.
  if (isActualError) {
    const errorMessage =
      error?.response?.data?.message ||
      "Couldn't load your upcoming recurring expenses.";
    return (
      <section className="upcoming-recurring upcoming-recurring--error">
        <div className="upcoming-recurring__header">
          <div className="upcoming-recurring__title-wrapper">
            <span className="upcoming-recurring__accent-bar" aria-hidden="true" />
            <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
          </div>
        </div>
        <FormStatus message={errorMessage} tone="error" />
        <button
          type="button"
          className="upcoming-recurring__retry"
          onClick={() => refetch()}
        >
          Try again
        </button>
      </section>
    );
  }

  const occurrences = payload?.data ?? [];
  const summary = payload?.summary ?? {};
  const groups = groupByMonth(occurrences);

  // EMPTY -- two distinct cases, two distinct messages.
  if (occurrences.length === 0) {
    const hasNoDefinitions = (summary.definitionCount ?? 0) === 0;
    return (
      <section className="upcoming-recurring upcoming-recurring--empty">
        <div className="upcoming-recurring__header">
          <div className="upcoming-recurring__title-wrapper">
            <span className="upcoming-recurring__accent-bar" aria-hidden="true" />
            <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
          </div>
        </div>
        <p className="upcoming-recurring__muted">
          {hasNoDefinitions
            ? "You haven't marked any expenses as recurring yet. Mark one from your expenses list and it will show up here."
            : "Your recurring expenses have nothing due in the next few months."}
        </p>
      </section>
    );
  }

  return (
    <section className="upcoming-recurring">
      <div className="upcoming-recurring__header">
        <div className="upcoming-recurring__title-wrapper">
          <span className="upcoming-recurring__accent-bar" aria-hidden="true" />
          <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
        </div>

        <p className="upcoming-recurring__summary">
          {summary.count} upcoming •{" "}
          <strong className="upcoming-recurring__summary-total">
            {formatMoney(undefined, summary.totalMinor)}
          </strong>{" "}
          total
        </p>
      </div>

      {/* STALE -- the schedule is behind, so these dates are already wrong. */}
      {summary.overdueCount > 0 && (
        <div className="upcoming-recurring__stale" role="status">
          <strong>
            {summary.overdueCount} {summary.overdueCount === 1 ? "occurrence" : "occurrences"} overdue.
          </strong>{" "}
          These were due already but haven't been logged yet — the scheduled
          job catches up one per day, so the dates below are when they were
          due, not when they'll appear.
        </div>
      )}

      <div className="upcoming-recurring__groups">
        {groups.map((group) => (
          <div key={group.monthKey} className="upcoming-recurring__group">
            <h3 className="upcoming-recurring__month">{monthLabel(group.monthKey)}</h3>
            <ul className="upcoming-recurring__list">
              {group.occurrences.map((occurrence) => {
                const CategoryIcon = getRecurringIcon(occurrence.expenseName, occurrence.expenseCategory);
                return (
                  <li
                    key={`${occurrence.recurringId}-${occurrence.dueDate}`}
                    className={
                      occurrence.overdue
                        ? "upcoming-recurring__item upcoming-recurring__item--overdue"
                        : "upcoming-recurring__item"
                    }
                  >
                    <div className="upcoming-recurring__item-main">
                      <div className="upcoming-recurring__icon-wrapper" aria-hidden="true">
                        <CategoryIcon className="upcoming-recurring__category-icon" />
                      </div>
                      <div className="upcoming-recurring__text-details">
                        <span className="upcoming-recurring__name">{occurrence.expenseName}</span>
                        <span className="upcoming-recurring__category">
                          {occurrence.expenseCategory}
                        </span>
                      </div>
                    </div>

                    <div className="upcoming-recurring__item-right">
                      <div className="upcoming-recurring__item-meta">
                        <span className="upcoming-recurring__date">
                          {format(parseISO(occurrence.dueCalendarDate), "d MMM")}
                          {occurrence.overdue && (
                            <span className="upcoming-recurring__badge"> overdue</span>
                          )}
                        </span>
                        <span className="upcoming-recurring__amount">
                          {formatMoney(occurrence.expenseAmount, occurrence.expenseAmountMinor)}
                        </span>
                      </div>

                      <div className="upcoming-recurring__item-actions">
                        <button
                          type="button"
                          className="upcoming-recurring__skip-btn"
                          onClick={() => setConfirmSkipOccurrence(occurrence)}
                          disabled={skipMutation.isPending}
                          title={`Skip ${occurrence.expenseName} for ${format(parseISO(occurrence.dueCalendarDate), "MMMM yyyy")}`}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {confirmSkipOccurrence && (
        <div
          className="upcoming-recurring__modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-skip-title"
        >
          <div className="upcoming-recurring__modal">
            <h3 id="confirm-skip-title" className="upcoming-recurring__modal-title">
              Skip This Month?
            </h3>
            <p className="upcoming-recurring__modal-text">
              Skip <strong>{confirmSkipOccurrence.expenseName}</strong> (
              {formatMoney(
                confirmSkipOccurrence.expenseAmount,
                confirmSkipOccurrence.expenseAmountMinor
              )}
              ) for{" "}
              <strong>
                {format(parseISO(confirmSkipOccurrence.dueCalendarDate), "MMMM yyyy")}
              </strong>
              ?
            </p>
            <p className="upcoming-recurring__modal-subtext">
              This will skip this month's expense only. Your recurring schedule will remain active and continue for future months.
            </p>
            <div className="upcoming-recurring__modal-actions">
              <button
                type="button"
                className="upcoming-recurring__modal-cancel"
                onClick={() => setConfirmSkipOccurrence(null)}
                disabled={skipMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="upcoming-recurring__modal-confirm"
                onClick={handleSkipConfirm}
                disabled={skipMutation.isPending}
              >
                {skipMutation.isPending ? "Skipping…" : "Skip this month"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UpcomingRecurring;
export { groupByMonth, monthLabel, STATUS };

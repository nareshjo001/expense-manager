import React, { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
// DAT-001-T06 -- all money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import { FormStatus } from "../a11y/FormStatus";
import { getUpcomingRecurring } from "../../api/recurringApi";
import { usePauseRecurringMutation } from "../../hooks/mutations/usePauseRecurringMutation";
import { useEndRecurringMutation } from "../../hooks/mutations/useEndRecurringMutation";
import {
  recurringActionSuccessToast,
  recurringActionErrorToast,
} from "../alertsEffects/toastMessages";
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
// REC-003-T05 update -- pause/edit actions, now that REC-002 exists:
//
//   EDIT    the "Edit" button below still calls onEditExpense(expenseId),
//           i.e. it opens the ORIGINAL, already-logged expense this
//           definition was created from -- NOT the recurring definition
//           itself. That is a real, useful action (fixing a typo on that one
//           historical row) but it does NOT change future occurrences:
//           cron/recurringJob.js reads the definition's own copied
//           expenseName/expenseCategory/expenseAmount fields when it logs
//           each occurrence, never the original expense (see
//           recurringLifecycleService.js's header for the full trace). A
//           previous version of this comment claimed the opposite; it was
//           wrong. To change what future occurrences look like, use "Pause"
//           or the recurring-management screen's "Edit", which edits the
//           definition itself via REC-002's editDefinition API.
//
//   PAUSE   every row here is, by construction, an occurrence of an ACTIVE
//           definition -- Controllers/RecurringExpenses/upcoming.js only
//           ever projects active ones, since a paused or ended definition
//           produces no occurrences to project. So "Pause" is the only
//           lifecycle action that belongs on a row here; "Resume" has
//           nothing to attach to (a paused definition has no row), and
//           lives on the recurring-management screen instead.
//
//   END     terminal, and offered here too since it is just as reachable
//           from a due occurrence as pausing is -- with a confirmation,
//           since it cannot be undone.

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

const UpcomingRecurring = ({ onEditExpense }) => {
  const [status, setStatus] = useState(STATUS.LOADING);
  const [payload, setPayload] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmEndRecurringId, setConfirmEndRecurringId] = useState(null);

  const pauseMutation = usePauseRecurringMutation();
  const endMutation = useEndRecurringMutation();

  // `isLive` guards every state write against landing after unmount.
  //
  // Not test hygiene: aborting the request does not cancel the promise
  // callbacks that are already queued, so a user who opens this panel and
  // navigates away before it resolves gets a setState on an unmounted
  // component. React logs that, and in a component that refetches it is also
  // how a stale response overwrites a newer one.
  const load = useCallback((signal, isLive = () => true) => {
    setStatus(STATUS.LOADING);
    setErrorMessage("");

    return getUpcomingRecurring(signal)
      .then((data) => {
        if (!isLive()) return;
        setPayload(data);
        setStatus(STATUS.READY);
      })
      .catch((err) => {
        if (!isLive()) return;
        // An aborted request is a component unmounting or a refetch
        // superseding this one -- not an error to show the user.
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;
        setStatus(STATUS.ERROR);
        setErrorMessage(
          err?.response?.data?.message ||
            "Couldn't load your upcoming recurring expenses."
        );
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    load(controller.signal, () => live);
    return () => {
      live = false;
      controller.abort();
    };
  }, [load]);

  // A paused/ended definition drops out of this projection entirely (see
  // the header comment on PAUSE above), so the only way this view can stay
  // correct after either action is to refetch it -- invalidating a
  // TanStack Query cache does nothing here since this component does not
  // use useQuery for its own data.
  const handlePause = (recurringId) => {
    pauseMutation.mutate(
      { id: recurringId },
      {
        onSuccess: () => {
          recurringActionSuccessToast("Recurring expense paused. It won't appear here until resumed.");
          load();
        },
        onError: (error) => recurringActionErrorToast(error.response?.data),
      }
    );
  };

  const handleEndConfirmed = () => {
    const recurringId = confirmEndRecurringId;
    endMutation.mutate(
      { id: recurringId },
      {
        onSuccess: () => {
          recurringActionSuccessToast("Recurring expense ended.");
          setConfirmEndRecurringId(null);
          load();
        },
        onError: (error) => {
          recurringActionErrorToast(error.response?.data);
          setConfirmEndRecurringId(null);
        },
      }
    );
  };

  if (status === STATUS.LOADING) {
    return (
      <section className="upcoming-recurring" aria-busy="true">
        <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
        <p className="upcoming-recurring__muted">Loading…</p>
      </section>
    );
  }

  // ERROR -- deliberately not rendered as an empty list. See the header.
  if (status === STATUS.ERROR) {
    return (
      <section className="upcoming-recurring">
        <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
        <FormStatus message={errorMessage} tone="error" />
        <button
          type="button"
          className="upcoming-recurring__retry"
          onClick={() => load()}
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
      <section className="upcoming-recurring">
        <h2 className="upcoming-recurring__title">Upcoming recurring</h2>
        <p className="upcoming-recurring__muted">
          {hasNoDefinitions
            ? "You haven't marked any expenses as recurring yet. Mark one from your expenses list and it will show up here."
            : "Your recurring expenses have nothing due in the next few months."}
        </p>
      </section>
    );
  }

  const confirmEndOccurrence = occurrences.find((o) => o.recurringId === confirmEndRecurringId);

  return (
    <section className="upcoming-recurring">
      <h2 className="upcoming-recurring__title">Upcoming recurring</h2>

      <p className="upcoming-recurring__summary">
        {summary.count} upcoming ·{" "}
        <strong>{formatMoney(undefined, summary.totalMinor)}</strong> total
      </p>

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

      {groups.map((group) => (
        <div key={group.monthKey} className="upcoming-recurring__group">
          <h3 className="upcoming-recurring__month">{monthLabel(group.monthKey)}</h3>
          <ul className="upcoming-recurring__list">
            {group.occurrences.map((occurrence) => (
              <li
                key={`${occurrence.recurringId}-${occurrence.dueDate}`}
                className={
                  occurrence.overdue
                    ? "upcoming-recurring__item upcoming-recurring__item--overdue"
                    : "upcoming-recurring__item"
                }
              >
                <div className="upcoming-recurring__item-main">
                  <span className="upcoming-recurring__name">{occurrence.expenseName}</span>
                  <span className="upcoming-recurring__category">
                    {occurrence.expenseCategory}
                  </span>
                </div>

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

                <div className="upcoming-recurring__actions">
                  {occurrence.expenseId && onEditExpense && (
                    <button
                      type="button"
                      className="upcoming-recurring__action"
                      onClick={() => onEditExpense(occurrence.expenseId)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="upcoming-recurring__action"
                    disabled={pauseMutation.isPending}
                    onClick={() => handlePause(occurrence.recurringId)}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="upcoming-recurring__action"
                    onClick={() => setConfirmEndRecurringId(occurrence.recurringId)}
                  >
                    End
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {confirmEndOccurrence && (
        <div className="modal-overlay">
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="upcoming-end-recurring-message"
          >
            <p id="upcoming-end-recurring-message">
              End "{confirmEndOccurrence.expenseName}"? This stops it permanently — it cannot be
              resumed, unlike pausing.
            </p>
            <div className="modal-buttons">
              <button onClick={() => setConfirmEndRecurringId(null)}>Cancel</button>
              <button onClick={handleEndConfirmed}>Yes, End</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UpcomingRecurring;
export { groupByMonth, monthLabel, STATUS };

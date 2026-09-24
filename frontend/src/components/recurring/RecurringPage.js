import React from "react";
import UpcomingRecurring from "./UpcomingRecurring";
import RecurringManagement from "./RecurringManagement";
import "./RecurringPage.css";

// REC-002-T05/REC-003 -- the recurring-expenses page: what's coming up
// (REC-003's projection, active definitions only) above the full set of
// definitions to pause/resume/end/edit (REC-002's lifecycle surface,
// regardless of status) below.
//
// Kept as two components rather than merged into one: they read from two
// different endpoints (a projection of occurrences vs. a list of
// definitions) with their own already-tested empty/error/stale handling
// (UpcomingRecurring) and status-aware actions (RecurringManagement) --
// merging them would mean reimplementing one inside the other for no gain.
const RecurringPage = ({ onEditExpense }) => {
  return (
    <div className="recurring-page">
      <UpcomingRecurring onEditExpense={onEditExpense} />
      <RecurringManagement />
    </div>
  );
};

export default RecurringPage;

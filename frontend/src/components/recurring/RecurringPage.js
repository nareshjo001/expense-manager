import React from "react";
import UpcomingRecurring from "./UpcomingRecurring";
import RecurringManagement from "./RecurringManagement";
import "./RecurringPage.css";

// T05/REC-003 -- the recurring-expenses page: what's coming up (REC-003's projection, active definitions only) above the full set of definitions to pause/resume/end/edit (REC-002's lifecycle surface, regardless of status) below.
const RecurringPage = ({ onEditExpense }) => {
  return (
    <div className="recurring-page">
      <UpcomingRecurring onEditExpense={onEditExpense} />
      <RecurringManagement />
    </div>
  );
};

export default RecurringPage;

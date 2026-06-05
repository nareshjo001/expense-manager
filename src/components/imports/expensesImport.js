import ExpenseItem from '../expensesHandling/ExpenseItem';
import SetBudget from '../expensesHandling/budget/SetBudget';

function formatDateRange(startDate, endDate) {
  const from = new Date(startDate);
  const to = new Date(endDate);

  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = from.getMonth() === to.getMonth();

  const monthShort = { month: "short" };

  const fromMonth = from.toLocaleDateString("en-US", monthShort);
  const toMonth = to.toLocaleDateString("en-US", monthShort);

  const fromDay = from.getDate();
  const toDay = to.getDate();

  const year = to.getFullYear();

  if (sameYear && sameMonth) {
    return `${fromMonth} ${fromDay}–${toDay}, ${year}`;
  }

  if (sameYear) {
    return `${fromMonth} ${fromDay} – ${toMonth} ${toDay}, ${year}`;
  }

  const options = { month: "short", day: "numeric", year: "numeric" };
  return `${from.toLocaleDateString("en-US", options)} – ${to.toLocaleDateString("en-US", options)}`;
}

export {
  ExpenseItem,
  SetBudget,
  formatDateRange
};

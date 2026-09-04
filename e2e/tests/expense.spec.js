'use strict';

// TST-001-T05 -- core "add an expense" journey: fill the real Add Expense
// form and see the new expense actually show up in the real expense list,
// backed by a real create request and a real re-fetch (frontend/src/components/expensesHandling/AddExpense.js
// -> useAddExpenseMutation -> POST /expense -> navigate('/') ->
// ExpensesPage re-renders from the live query).
const { test, expect } = require('@playwright/test');
const { loginAsE2EUser } = require('./helpers/login');

test.describe('Expenses', () => {
  test('adds an expense and sees it appear in the expense list', async ({ page }) => {
    await loginAsE2EUser(page);

    await page.getByRole('link', { name: 'Add' }).click();

    // A unique name per run: makes the "did it actually show up" assertion
    // below unambiguous regardless of whatever else is already in this
    // seeded user's expense history from earlier runs.
    const expenseName = `E2E Grocery Run ${Date.now()}`;

    // The default (unfiltered) expense list only ever returns expenses
    // dated within the last 7 days -- backend/Controllers/GetExpenseControllers/lastweekexpense.js
    // filters strictly on `expenseDate >= sevenDaysAgo`. Using today's date
    // (rather than an arbitrary fixed date) is required for this expense to
    // actually appear in that list, not just an arbitrary choice.
    const todayISO = new Date().toISOString().slice(0, 10);

    // frontend/src/components/expensesHandling/AddExpense.js's inputs are
    // each wired to a real <label htmlFor>, so these are genuine
    // accessible-name lookups, not a fallback.
    await page.getByLabel('Name of the Expense').fill(expenseName);
    // "Category" is exact-matched: the same <label> conditionally renders
    // an inline "ML confidence" sub-string once a prediction lands, so a
    // loose match would become ambiguous later in this same form's
    // lifecycle.
    await page.getByLabel('Category', { exact: true }).fill('Groceries');
    await page.getByLabel('Amount Spent').fill('42.50');
    await page.getByLabel('Date Spent').fill(todayISO);

    // NOT `getByRole('button', { name: 'Add Expense' })`: the Add/Add
    // Income type toggle right above this form (frontend/src/components/expensesHandling/Add.js)
    // has its own button ALSO literally labelled "Add Expense", so a
    // role+name lookup here is a genuine two-match ambiguity. The form's
    // own existing `.submit-btn` class (scoped to the `.add-expense` form)
    // resolves it without needing a new attribute.
    // Wait for the actual create request to complete (POST
    // /expense/add-expense) before asserting on its effects, rather than
    // racing the click against the mutation's own async chain (network
    // round-trip -> onSuccess -> invalidateQueries -> navigate('/') ->
    // ExpensesPage remount -> refetch -> render). A plain click-then-assert
    // races that whole chain against a single fixed timeout with no signal
    // for *why* it's slow if it ever is.
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/expense/add-expense') && resp.request().method() === 'POST',
        { timeout: 30_000 }
      ),
      page.locator('form.add-expense .submit-btn').click(),
    ]);

    // A successful submit navigates back to "/" (the expense list) and the
    // new expense renders under its date-range group, once the invalidated
    // expenses query refetches. 30s (not the default 15s) gives this
    // suite's first-ever live CI run -- cold containers, an un-warmed CRA
    // dev server -- room to finish that refetch+render without being a
    // silent pass/fail coin-flip.
    await expect(page.getByText(expenseName)).toBeVisible({ timeout: 30_000 });
  });
});

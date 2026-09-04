'use strict';

// TST-001-T05 -- core "set a monthly budget" journey: from the expense
// list (frontend/src/components/expensesHandling/ExpensesPage.js renders
// <SetBudget /> at the top), set this month's budget and see it reflected
// as a real BudgetBar, backed by a real POST /api's budget-create route
// and a real re-fetch (useBudgetSummary).
const { test, expect } = require('@playwright/test');
const { loginAsE2EUser } = require('./helpers/login');

const BUDGET_AMOUNT = '5000';

test.describe('Budget', () => {
  test('sets this month\'s budget and sees it reflected on the dashboard', async ({ page }) => {
    await loginAsE2EUser(page);

    // frontend/src/components/expensesHandling/budget/SetBudget.js shows
    // one of two states for the current month: an initial "Set" prompt, or
    // (once a budget already exists for this month) the BudgetBar
    // directly. A single fixed seeded user persists its budget across
    // repeated LOCAL runs against a reused dev server/DB (unlike CI's
    // always-fresh ephemeral Mongo), so this handles both: exercise the
    // real create flow when nothing is set yet, and still verify the
    // BudgetBar renders correctly either way.
    const setBudgetButton = page.getByRole('button', { name: 'Set', exact: true });
    const needsToSetBudget = await setBudgetButton.isVisible().catch(() => false);

    if (needsToSetBudget) {
      await setBudgetButton.click();
      await page.getByPlaceholder('Enter Your Budget').fill(BUDGET_AMOUNT);

      // Same reasoning as expense.spec.js: wait for the actual create
      // request (POST /api/setbudget) to resolve before relying on the
      // invalidated budgets query's refetch to swap the form for the
      // BudgetBar, instead of racing that whole async chain against a
      // single fixed timeout on the other end.
      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/setbudget') && resp.request().method() === 'POST',
          { timeout: 30_000 }
        ),
        page.getByRole('button', { name: 'Confirm' }).click(),
      ]);
    }

    // frontend/src/components/expensesHandling/budget/BudgetBar.js's
    // wrapper -- an existing, stable class, unconditionally rendered
    // (unlike its hover-only tooltip contents, which CSS keeps hidden
    // until :hover and so aren't a reliable Playwright visibility target).
    // 30s (not the default 15s) for the same cold-CI/first-live-run reason
    // as expense.spec.js.
    await expect(page.locator('.budget-bar-wrapper')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Budget - [A-Za-z]{3}/)).toBeVisible();
  });
});

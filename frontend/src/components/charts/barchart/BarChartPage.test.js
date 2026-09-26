import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BarChartPage from './BarChartPage';
import { useBarChartQuery } from '../../../hooks/queries/useBarChartQuery';
import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import { useReport } from '../../../hooks/useReport';

// FE-001 -- BarChartPage must show an explicit loading/error(+retry)/empty
// state instead of silently rendering nothing (the pre-FE-001 behavior for
// every one of those three situations was an identical blank area).
jest.mock('../../../hooks/queries/useBarChartQuery', () => ({
  useBarChartQuery: jest.fn(),
}));

jest.mock('../../contexts/ai-contexts/ChartInsightsContext', () => ({
  useChartInsights: jest.fn(),
}));

jest.mock('../../../hooks/useReport', () => ({
  useReport: jest.fn(),
}));

jest.mock('../../imports/chartsImport', () => ({
  ThemeContext: require('react').createContext('light-theme'),
  BarChartWrapper: () => <div data-testid="mock-bar-chart-wrapper" />,
}));

jest.mock('../../insights/InlineChartInsight', () => (props) => (
  <div data-testid="mock-inline-insight" data-severity={props.item?.severity}>{props.item?.text}</div>
));

const mockChartInsights = () => ({
  notifyChartFilterApplied: jest.fn(),
  clearChartInsights: jest.fn(),
  isChartInsightReady: false,
  chartInsightText: null,
});

beforeEach(() => {
  // Safe default so tests that don't care about the report (all the
  // pre-existing FE-001 suites) don't crash on useReport()'s destructure;
  // the ANL-001-T04/T05 suite below overrides this per test.
  useReport.mockReturnValue({ data: undefined });
});

afterEach(() => {
  cleanup();
});

describe('BarChartPage -- explicit query states (FE-001)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
  });

  it('shows no query state when no filter is selected yet (query disabled)', () => {
    useBarChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: false, enabled: false, refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.getByText('Select desirable filter to visualize!')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an explicit loading state while an enabled query is loading', () => {
    useBarChartQuery.mockReturnValue({
      data: undefined, isLoading: true, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your chart...');
    expect(screen.queryByTestId('mock-bar-chart-wrapper')).not.toBeInTheDocument();
  });

  it('shows an explicit error state with retry when an enabled query fails', () => {
    const refetch = jest.fn();
    useBarChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: true, enabled: true, refetch,
    });

    render(<BarChartPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this chart. Please try again.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit empty state (distinct from the error state) when the query succeeds with no data', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [] }, isLoading: false, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.getByText('No expenses found for this filter.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-bar-chart-wrapper')).not.toBeInTheDocument();
  });

  it('renders the chart wrapper once the query succeeds with data', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [{ month: 'Jan', total: 100 }] },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.getByTestId('mock-bar-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BarChartPage -- stale chart preserved during background refetch (FE-001-T05)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
  });

  it('keeps rendering the previous chart (not the loading state) while a filter change refetches in the background', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [{ month: 'Jan', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<BarChartPage />);

    // The stale chart stays on screen -- no loading spinner takes its place.
    expect(screen.getByTestId('mock-bar-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByText('Loading your chart...')).not.toBeInTheDocument();
  });

  it('shows the "Updating chart" affordance only while isFetching and isPlaceholderData are both true', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [{ month: 'Jan', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.getByText('Updating chart\u2026')).toBeInTheDocument();
  });

  it('does not show the "Updating chart" affordance for a plain settled query (no placeholder data in play)', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [{ month: 'Jan', total: 100 }] },
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.queryByText('Updating chart\u2026')).not.toBeInTheDocument();
  });

  it('does not show the "Updating chart" affordance merely because a background refetch is running on settled (non-placeholder) data', () => {
    useBarChartQuery.mockReturnValue({
      data: { success: true, data: [{ month: 'Jan', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<BarChartPage />);

    expect(screen.queryByText('Updating chart\u2026')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-bar-chart-wrapper')).toBeInTheDocument();
  });
});

describe('BarChartPage -- backend-driven bar chart insight (ANL-001-T04/T05)', () => {
  // Fixed "now" so the component's own currentYearMonth computation
  // (new Date() at effect time) is deterministic in the test.
  const CURRENT_YEAR_MONTH = '2026-09';
  const NON_CURRENT_YEAR_MONTH = '2026-01';

  const barChartData = [{ category: 'Groceries', total: 500 }];

  const selectBarCategoryFilter = ({ specific, monthValue } = {}) => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bycategory' } });
    if (specific) {
      fireEvent.click(screen.getByLabelText('View for specific month'));
      fireEvent.change(screen.getByLabelText('Select month'), { target: { value: monthValue } });
    }
  };

  // Drives the UI to "bycategory" + "specific month" checked, WITHOUT
  // picking a month yet -- leaves the final, decisive state change (setting
  // the month) for the test itself, so a captured "calls before" count
  // isolates just that last transition instead of the two earlier,
  // genuinely non-matching intermediate states (bycategory/no-specific,
  // then bycategory/specific/no-month-yet) that legitimately call
  // notifyChartFilterApplied on the way there.
  const openBarCategorySpecificMonth = () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bycategory' } });
    fireEvent.click(screen.getByLabelText('View for specific month'));
    return screen.getByLabelText('Select month');
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));

    useBarChartQuery.mockReturnValue({
      data: { success: true, data: barChartData },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('matching filter (bycategory, specific current month) with hasData: true', () => {
    it.each([
      [0.85, 'HIGH', 'A large share of spending was concentrated in Groceries, accounting for 55% of the total.'],
      [0.6, 'MEDIUM', 'Groceries was the largest spending category during this period at 55% of total spending.'],
      [0.2, 'LOW', 'Spending was fairly balanced across categories during this period.'],
    ])('renders the backend-driven insight for concentrationRatio=%s', (concentrationRatio, expectedSeverity, expectedText) => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({
        data: {
          insights: {
            chartFindings: {
              bar: { hasData: true, pressureCategory: 'Safe', concentrationRatio },
            },
          },
          categories: {
            monthly: {
              categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
            },
          },
        },
      });

      render(<BarChartPage />);
      const monthInput = openBarCategorySpecificMonth();
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      fireEvent.change(monthInput, { target: { value: CURRENT_YEAR_MONTH } });

      const insight = screen.getByTestId('mock-inline-insight');
      expect(insight).toHaveAttribute('data-severity', expectedSeverity);
      expect(insight).toHaveTextContent(expectedText);
      // Sourced from the new backend-driven path, not from the frontend
      // rules engine via notifyChartFilterApplied.
      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBe(callsBefore);
    });
  });

  it('falls back to notifyChartFilterApplied exactly as before when hasData is false (the budget-gating gotcha)', () => {
    const chartInsights = mockChartInsights();
    useChartInsights.mockReturnValue(chartInsights);
    useReport.mockReturnValue({
      data: {
        insights: {
          chartFindings: {
            bar: { hasData: false, pressureCategory: null, concentrationRatio: null },
          },
        },
        categories: {
          monthly: {
            categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
          },
        },
      },
    });

    render(<BarChartPage />);
    const monthInput = openBarCategorySpecificMonth();
    const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

    fireEvent.change(monthInput, { target: { value: CURRENT_YEAR_MONTH } });

    expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBe(callsBefore + 1);
    expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(barChartData, 'bar', 'bycategory');
    // No backend-driven insight was rendered.
    expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
  });

  describe('non-matching filter always uses notifyChartFilterApplied, even with valid matching-shaped report.insights', () => {
    const matchingShapedReport = {
      insights: {
        chartFindings: {
          bar: { hasData: true, pressureCategory: 'Safe', concentrationRatio: 0.85 },
        },
      },
      categories: {
        monthly: {
          categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
        },
      },
    };

    it('viewBy: bymonth', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<BarChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bymonth' } });

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(barChartData, 'bar', 'bymonth');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });

    it('bycategory without specificMonth', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<BarChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bycategory' } });

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(barChartData, 'bar', 'bycategory');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });

    it('bycategory with specificMonth but a non-current month selected', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<BarChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      selectBarCategoryFilter({ specific: true, monthValue: NON_CURRENT_YEAR_MONTH });

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(barChartData, 'bar', 'bycategory');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });
  });

  it('falls back cleanly with no crash when the report itself is not yet loaded', () => {
    const chartInsights = mockChartInsights();
    useChartInsights.mockReturnValue(chartInsights);
    useReport.mockReturnValue({ data: undefined });

    render(<BarChartPage />);
    const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

    expect(() => {
      selectBarCategoryFilter({ specific: true, monthValue: CURRENT_YEAR_MONTH });
    }).not.toThrow();

    expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(barChartData, 'bar', 'bycategory');
    expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
  });
});

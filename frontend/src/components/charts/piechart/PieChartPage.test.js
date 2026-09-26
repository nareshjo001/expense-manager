import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PieChartPage from './PieChartPage';
import { usePieChartQuery } from '../../../hooks/queries/usePieChartQuery';
import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import { useReport } from '../../../hooks/useReport';

// Real framer-motion's AnimatePresence keeps an exiting element mounted
// until its exit animation completes, which doesn't resolve synchronously
// in jsdom -- strip it down to plain passthrough elements so tests observe
// only the component's own conditional rendering, matching the convention
// already established in ExpensesPage.test.js.
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children }) => <div>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

// FE-001-T07 -- PieChartPage must show an explicit loading/error(+retry)/empty
// state instead of silently rendering nothing (the pre-FE-001 behavior for
// every one of those three situations was an identical blank area). Mirrors
// the state-matrix coverage already established for BarChartPage.test.js.
jest.mock('../../../hooks/queries/usePieChartQuery', () => ({
  usePieChartQuery: jest.fn(),
}));

jest.mock('../../contexts/ai-contexts/ChartInsightsContext', () => ({
  useChartInsights: jest.fn(),
}));

// ANL-001-T05 -- backing hook for the backend-driven pie insight (ANL-001-T04).
jest.mock('../../../hooks/useReport', () => ({
  useReport: jest.fn(),
}));

jest.mock('../../imports/chartsImport', () => ({
  PieChartWrapper: () => <div data-testid="mock-pie-chart-wrapper" />,
}));

// Renders the item passed to InlineChartInsight so tests can assert on the
// actual text/severity it was given, matching the convention established in
// BarChartPage.test.js.
jest.mock('../../insights/InlineChartInsight', () => (props) => (
  <div data-testid="mock-inline-insight" data-severity={props.item?.severity}>{props.item?.text}</div>
));

const mockChartInsights = () => ({
  notifyChartFilterApplied: jest.fn(),
  clearChartInsights: jest.fn(),
  isChartInsightReady: false,
  chartInsightText: null,
});

// Initially only the "Show" select is rendered; once `show` is 'distribution'
// or 'count' the "View by" select is also rendered, ahead of it in the DOM --
// so the "Show" select is always the LAST combobox, and "View by" (when
// present) is always the first.
const selectPieFilter = (show, viewBy) => {
  const showSelects = screen.getAllByRole('combobox');
  fireEvent.change(showSelects[showSelects.length - 1], { target: { value: show } });

  if (viewBy) {
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: viewBy } });
  }
};

afterEach(() => {
  cleanup();
});

describe('PieChartPage -- explicit query states (FE-001-T07)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
    useReport.mockReturnValue({ data: undefined });
  });

  it('shows no query state when no filter is selected yet (query disabled)', () => {
    usePieChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: false, enabled: false, refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByText('Select desirable filter to visualize!')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an explicit loading state while an enabled query is loading', () => {
    usePieChartQuery.mockReturnValue({
      data: undefined, isLoading: true, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your chart...');
    expect(screen.queryByTestId('mock-pie-chart-wrapper')).not.toBeInTheDocument();
  });

  it('shows an explicit error state with retry when an enabled query fails', () => {
    const refetch = jest.fn();
    usePieChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: true, enabled: true, refetch,
    });

    render(<PieChartPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this chart. Please try again.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit empty state (distinct from the error state) when the query succeeds with no data', () => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: [] }, isLoading: false, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByText('No expenses found for this filter.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-pie-chart-wrapper')).not.toBeInTheDocument();
  });

  it('renders the chart wrapper once the query succeeds with data', () => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: [{ category: 'Food', total: 100 }] },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByTestId('mock-pie-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PieChartPage -- backend-driven pie insight (ANL-001-T04/T05)', () => {
  const pieChartData = [{ category: 'Groceries', total: 550 }];

  const matchingShapedReport = {
    insights: {
      chartFindings: {
        pie: { hasData: true, concentrationRatio: 0.5, topSlice: 'Groceries' },
      },
    },
    categories: {
      monthly: {
        categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
      },
    },
  };

  beforeEach(() => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: pieChartData },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });
  });

  describe('matching filter (distribution, thismonth) with hasData: true', () => {
    it.each([
      [0.5, 'HIGH', 'A large share of spending was concentrated in Groceries, accounting for 55% of total spending.'],
      [0.25, 'MEDIUM', 'Groceries was the largest spending category during this period at 55% of total spending.'],
      [0.1, 'LOW', 'Spending was fairly balanced across categories during this period.'],
    ])('renders the backend-driven insight for concentrationRatio=%s', (concentrationRatio, expectedSeverity, expectedText) => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({
        data: {
          insights: {
            chartFindings: {
              pie: { hasData: true, concentrationRatio, topSlice: 'Groceries' },
            },
          },
          categories: {
            monthly: {
              categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
            },
          },
        },
      });

      render(<PieChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      selectPieFilter('distribution');

      const insight = screen.getByTestId('mock-inline-insight');
      expect(insight).toHaveAttribute('data-severity', expectedSeverity);
      expect(insight).toHaveTextContent(expectedText);
      // Sourced from the new backend-driven path, not from
      // notifyChartFilterApplied's mocked return.
      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBe(callsBefore);
    });
  });

  it('falls back to notifyChartFilterApplied exactly as before when hasData is false', () => {
    const chartInsights = mockChartInsights();
    useChartInsights.mockReturnValue(chartInsights);
    useReport.mockReturnValue({
      data: {
        insights: {
          chartFindings: {
            pie: { hasData: false, concentrationRatio: null, topSlice: null },
          },
        },
        categories: {
          monthly: {
            categoryDistribution: [{ category: 'Groceries', amount: 550, percentage: 55 }],
          },
        },
      },
    });

    render(<PieChartPage />);
    const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

    selectPieFilter('distribution');

    expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBe(callsBefore + 1);
    expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(pieChartData, 'pie', 'distribution');
    // No backend-driven insight was rendered.
    expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
  });

  describe('non-matching filter always uses notifyChartFilterApplied, even with valid matching-shaped report.insights', () => {
    it('show: count', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<PieChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      selectPieFilter('count');

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(pieChartData, 'pie', 'count');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });

    it('show: comparison', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<PieChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      selectPieFilter('comparison');

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(pieChartData, 'pie', 'comparison');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });

    it('distribution with viewBy: thisyear', () => {
      const chartInsights = mockChartInsights();
      useChartInsights.mockReturnValue(chartInsights);
      useReport.mockReturnValue({ data: matchingShapedReport });

      render(<PieChartPage />);
      const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

      selectPieFilter('distribution', 'thisyear');

      expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(pieChartData, 'pie', 'distribution');
      expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
    });
  });

  it('falls back cleanly with no crash when the report itself is not yet loaded', () => {
    const chartInsights = mockChartInsights();
    useChartInsights.mockReturnValue(chartInsights);
    useReport.mockReturnValue({ data: undefined });

    render(<PieChartPage />);
    const callsBefore = chartInsights.notifyChartFilterApplied.mock.calls.length;

    expect(() => {
      selectPieFilter('distribution');
    }).not.toThrow();

    expect(chartInsights.notifyChartFilterApplied.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(chartInsights.notifyChartFilterApplied).toHaveBeenLastCalledWith(pieChartData, 'pie', 'distribution');
    expect(screen.queryByTestId('mock-inline-insight')).not.toBeInTheDocument();
  });
});

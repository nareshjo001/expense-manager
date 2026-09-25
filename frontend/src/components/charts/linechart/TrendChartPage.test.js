import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TrendChartPage from './TrendChartPage';
import { useTrendChartQuery } from '../../../hooks/queries/useTrendChartQuery';
import { useLoggedYearsQuery } from '../../../hooks/queries/useLoggedYearsQuery';
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

// FE-001-T07 -- TrendChartPage must show an explicit loading/error(+retry)/empty
// state instead of silently rendering nothing (the pre-FE-001 behavior for
// every one of those three situations was an identical blank area). Mirrors
// the state-matrix coverage already established for BarChartPage.test.js.
jest.mock('../../../hooks/queries/useTrendChartQuery', () => ({
  useTrendChartQuery: jest.fn(),
}));

jest.mock('../../../hooks/queries/useLoggedYearsQuery', () => ({
  useLoggedYearsQuery: jest.fn(),
}));

jest.mock('../../contexts/ai-contexts/ChartInsightsContext', () => ({
  useChartInsights: jest.fn(),
}));

// ANL-001-T04/T05 -- the line chart's insight card can now be sourced from
// the backend report's insights instead of the frontend rule; mocked the
// same way as the other data-source hooks above.
jest.mock('../../../hooks/useReport', () => ({
  useReport: jest.fn(),
}));

jest.mock('../../imports/chartsImport', () => ({
  ThemeContext: require('react').createContext('light-theme'),
  TrendChartWrapper: () => <div data-testid="mock-trend-chart-wrapper" />,
  MultiTrendChartWrapper: () => <div data-testid="mock-multi-trend-chart-wrapper" />,
  getSelectStyles: () => ({}),
}));

jest.mock('../../insights/InlineChartInsight', () => ({ item }) => (
  <div data-testid="mock-inline-insight" data-item={JSON.stringify(item)} />
));

jest.mock('react-select', () => (props) => (
  <select data-testid="mock-year-select" multiple onChange={() => {}}>
    {(props.options || []).map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
));

const mockChartInsights = () => ({
  notifyChartFilterApplied: jest.fn(),
  clearChartInsights: jest.fn(),
  isChartInsightReady: false,
  chartInsightText: null,
});

afterEach(() => {
  cleanup();
});

describe('TrendChartPage -- explicit query states (FE-001-T07)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
    useLoggedYearsQuery.mockReturnValue({ data: { success: true, data: [2025, 2026] } });
    useReport.mockReturnValue({ data: undefined });
  });

  it('shows no query state when no filter is selected yet (query disabled)', () => {
    useTrendChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: false, enabled: false, refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByText('Select desirable filter to visualize!')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an explicit loading state while an enabled query is loading', () => {
    useTrendChartQuery.mockReturnValue({
      data: undefined, isLoading: true, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your chart...');
    expect(screen.queryByTestId('mock-trend-chart-wrapper')).not.toBeInTheDocument();
  });

  it('shows an explicit error state with retry when an enabled query fails', () => {
    const refetch = jest.fn();
    useTrendChartQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: true, enabled: true, refetch,
    });

    render(<TrendChartPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this chart. Please try again.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit empty state (distinct from the error state) when the query succeeds with no data', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [] }, isLoading: false, isError: false, enabled: true, refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByText('No expenses found for this filter.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-trend-chart-wrapper')).not.toBeInTheDocument();
  });

  it('renders the chart wrapper once the query succeeds with data', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [{ week: 'W1', total: 100 }] },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByTestId('mock-trend-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the multi-year comparison wrapper (not the single-trend wrapper) when compareByYear is toggled on', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [{ year: 2025, total: 100 }, { year: 2026, total: 150 }] },
      isLoading: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    fireEvent.change(screen.getByDisplayValue('View By'), { target: { value: 'byyear' } });
    fireEvent.click(screen.getByLabelText('Compare Between Years'));

    expect(screen.getByTestId('mock-multi-trend-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-trend-chart-wrapper')).not.toBeInTheDocument();
  });
});

// ANL-001-T04/T05 -- the line chart's insight now sources from the backend
// report's insights (report.insights.chartFindings.line) for the ONE filter
// combination that snapshot faithfully describes: viewBy === 'bymonth' with
// selectedYear === the current calendar year. Every other state must keep
// going through notifyChartFilterApplied (the pre-existing frontend rule),
// unchanged -- these tests prove both the new backend-driven path and that
// the scoping guard actually confines it to that one case.
describe("TrendChartPage -- backend-driven line insight (ANL-001-T04/T05)", () => {
  const CURRENT_YEAR = new Date().getFullYear();

  // A sentinel distinct from anything the backend-driven mapping below could
  // ever produce, so a test asserting on it can only pass if the rendered
  // item really came from notifyChartFilterApplied's mocked chartInsightText
  // (the frontend-rule fallback path), not from the new backend path.
  const FRONTEND_RULE_SENTINEL = {
    text: "FRONTEND_RULE_SENTINEL",
    severity: "HIGH",
    trend: "UP",
  };

  const baseTrendChartQueryResult = {
    data: { success: true, data: [{ month: "Jan", total: 100 }] },
    isLoading: false,
    isError: false,
    enabled: true,
    refetch: jest.fn(),
  };

  const renderWithCurrentYearMonthlyView = () => {
    render(<TrendChartPage />);
    fireEvent.change(screen.getByDisplayValue("View By"), { target: { value: "bymonth" } });
    fireEvent.change(screen.getByPlaceholderText("Year ?"), { target: { value: String(CURRENT_YEAR) } });
  };

  beforeEach(() => {
    useTrendChartQuery.mockReturnValue(baseTrendChartQueryResult);
    useLoggedYearsQuery.mockReturnValue({ data: { success: true, data: [2025, 2026] } });
    useChartInsights.mockReturnValue({
      notifyChartFilterApplied: jest.fn(),
      clearChartInsights: jest.fn(),
      isChartInsightReady: true,
      chartInsightText: FRONTEND_RULE_SENTINEL,
    });
  });

  it.each([
    ["up", 40, { severity: "HIGH", trend: "UP", text: "Spending has been trending upward recently." }],
    ["up", 10, { severity: "MEDIUM", trend: "UP", text: "Spending has shown an upward pattern in recent periods." }],
    ["down", -40, { severity: "MEDIUM", trend: "DOWN", text: "Spending has been trending downward recently." }],
    ["down", -10, { severity: "LOW", trend: "DOWN", text: "Spending has shown a downward pattern in recent periods." }],
    ["same", 0, { severity: "LOW", trend: "FLAT", text: "Your spending stayed at similar levels during this period." }],
  ])(
    "matching filter (bymonth, current year) + hasData renders the backend-driven insight for direction=%s, volatility=%s",
    (direction, volatility, expected) => {
      useReport.mockReturnValue({
        data: { insights: { chartFindings: { line: { hasData: true, direction, volatility } } } },
      });

      renderWithCurrentYearMonthlyView();

      const rendered = JSON.parse(screen.getByTestId("mock-inline-insight").getAttribute("data-item"));
      expect(rendered).toEqual(expected);
      // Proves this came from the new backend path, not the mocked frontend-rule fallback.
      expect(rendered).not.toEqual(FRONTEND_RULE_SENTINEL);
    }
  );

  it("matching filter but hasData: false falls back to notifyChartFilterApplied exactly as before", () => {
    useReport.mockReturnValue({
      data: { insights: { chartFindings: { line: { hasData: false, direction: "up", volatility: 40 } } } },
    });

    renderWithCurrentYearMonthlyView();

    const rendered = JSON.parse(screen.getByTestId("mock-inline-insight").getAttribute("data-item"));
    expect(rendered).toEqual(FRONTEND_RULE_SENTINEL);
  });

  it("non-matching filter (bymonth, non-current year) always uses notifyChartFilterApplied, even with valid matching-shaped backend data", () => {
    useReport.mockReturnValue({
      data: {
        insights: {
          chartFindings: { line: { hasData: true, direction: "up", volatility: 40 } },
        },
      },
    });

    render(<TrendChartPage />);
    fireEvent.change(screen.getByDisplayValue("View By"), { target: { value: "bymonth" } });
    fireEvent.change(screen.getByPlaceholderText("Year ?"), { target: { value: String(CURRENT_YEAR - 1) } });

    const rendered = JSON.parse(screen.getByTestId("mock-inline-insight").getAttribute("data-item"));
    expect(rendered).toEqual(FRONTEND_RULE_SENTINEL);
  });

  it("non-matching filter (week) always uses notifyChartFilterApplied, even with valid matching-shaped backend data", () => {
    useReport.mockReturnValue({
      data: {
        insights: {
          chartFindings: { line: { hasData: true, direction: "up", volatility: 40 } },
        },
      },
    });

    render(<TrendChartPage />);
    fireEvent.change(screen.getByDisplayValue("View By"), { target: { value: "week" } });

    const rendered = JSON.parse(screen.getByTestId("mock-inline-insight").getAttribute("data-item"));
    expect(rendered).toEqual(FRONTEND_RULE_SENTINEL);
  });

  it("report not yet loaded falls back cleanly with no crash", () => {
    useReport.mockReturnValue({ data: undefined });

    expect(() => renderWithCurrentYearMonthlyView()).not.toThrow();

    const rendered = JSON.parse(screen.getByTestId("mock-inline-insight").getAttribute("data-item"));
    expect(rendered).toEqual(FRONTEND_RULE_SENTINEL);
  });
});

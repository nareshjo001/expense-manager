import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TrendChartPage from './TrendChartPage';
import { useTrendChartQuery } from '../../../hooks/queries/useTrendChartQuery';
import { useLoggedYearsQuery } from '../../../hooks/queries/useLoggedYearsQuery';
import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';

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

jest.mock('../../imports/chartsImport', () => ({
  ThemeContext: require('react').createContext('light-theme'),
  TrendChartWrapper: () => <div data-testid="mock-trend-chart-wrapper" />,
  MultiTrendChartWrapper: () => <div data-testid="mock-multi-trend-chart-wrapper" />,
  getSelectStyles: () => ({}),
}));

jest.mock('../../insights/InlineChartInsight', () => () => <div data-testid="mock-inline-insight" />);

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

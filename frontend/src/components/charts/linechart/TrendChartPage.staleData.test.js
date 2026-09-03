import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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

// FE-001-T05 -- a filter change on TrendChartPage refetches a NEW query key
// (useTrendChartQuery uses `placeholderData: keepPreviousData`), so the
// previously rendered chart must stay on screen instead of being replaced
// by QueryState's loading state, with a subtle "Updating chart" affordance
// surfaced while that background refetch is in flight.
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
  TrendChartWrapper: ({ data }) => <div data-testid="mock-trend-chart-wrapper" data-count={data.length} />,
  MultiTrendChartWrapper: () => <div data-testid="mock-multi-trend-chart-wrapper" />,
  getSelectStyles: () => ({}),
}));

jest.mock('../../insights/InlineChartInsight', () => () => <div data-testid="mock-inline-insight" />);

jest.mock('react-select', () => (props) => (
  <select
    data-testid="mock-year-select"
    multiple
    onChange={() => {}}
  >
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

describe('TrendChartPage -- stale chart preserved during background refetch (FE-001-T05)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
    useLoggedYearsQuery.mockReturnValue({ data: { success: true, data: [2025, 2026] } });
  });

  it('keeps rendering the previous chart (not the loading state) while a filter change refetches in the background', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [{ week: 'W1', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByTestId('mock-trend-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByText('Loading your chart...')).not.toBeInTheDocument();
  });

  it('shows the "Updating chart" affordance only while isFetching and isPlaceholderData are both true', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [{ week: 'W1', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByText('Updating chart…')).toBeInTheDocument();
  });

  it('does not show the "Updating chart" affordance for a plain settled query (no placeholder data in play)', () => {
    useTrendChartQuery.mockReturnValue({
      data: { success: true, data: [{ week: 'W1', total: 100 }] },
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.queryByText('Updating chart…')).not.toBeInTheDocument();
  });

  it('never shows the affordance while the query is disabled (no filter chosen yet)', () => {
    useTrendChartQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      enabled: false,
      refetch: jest.fn(),
    });

    render(<TrendChartPage />);

    expect(screen.getByText('Select desirable filter to visualize!')).toBeInTheDocument();
    expect(screen.queryByText('Updating chart…')).not.toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import PieChartPage from './PieChartPage';
import { usePieChartQuery } from '../../../hooks/queries/usePieChartQuery';
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

// FE-001-T05 -- a filter change on PieChartPage refetches a NEW query key
// (usePieChartQuery uses `placeholderData: keepPreviousData`), so the
// previously rendered chart must stay on screen instead of being replaced
// by QueryState's loading state, with a subtle "Updating chart" affordance
// surfaced while that background refetch is in flight.
jest.mock('../../../hooks/queries/usePieChartQuery', () => ({
  usePieChartQuery: jest.fn(),
}));

jest.mock('../../contexts/ai-contexts/ChartInsightsContext', () => ({
  useChartInsights: jest.fn(),
}));

jest.mock('../../imports/chartsImport', () => ({
  PieChartWrapper: ({ data, show }) => (
    <div data-testid="mock-pie-chart-wrapper" data-show={show} data-count={data.length} />
  ),
}));

jest.mock('../../insights/InlineChartInsight', () => () => <div data-testid="mock-inline-insight" />);

const mockChartInsights = () => ({
  notifyChartFilterApplied: jest.fn(),
  clearChartInsights: jest.fn(),
  isChartInsightReady: false,
  chartInsightText: null,
});

afterEach(() => {
  cleanup();
});

describe('PieChartPage -- stale chart preserved during background refetch (FE-001-T05)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
  });

  it('keeps rendering the previous chart (not the loading state) while a filter change refetches in the background', () => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: [{ category: 'Food', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByTestId('mock-pie-chart-wrapper')).toBeInTheDocument();
    expect(screen.queryByText('Loading your chart...')).not.toBeInTheDocument();
  });

  it('shows the "Updating chart" affordance only while isFetching and isPlaceholderData are both true', () => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: [{ category: 'Food', total: 100 }] },
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByText('Updating chart…')).toBeInTheDocument();
  });

  it('does not show the "Updating chart" affordance for a plain settled query (no placeholder data in play)', () => {
    usePieChartQuery.mockReturnValue({
      data: { success: true, data: [{ category: 'Food', total: 100 }] },
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      enabled: true,
      refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.queryByText('Updating chart…')).not.toBeInTheDocument();
  });

  it('never shows the affordance while the query is disabled (no filter chosen yet)', () => {
    usePieChartQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      enabled: false,
      refetch: jest.fn(),
    });

    render(<PieChartPage />);

    expect(screen.getByText('Select desirable filter to visualize!')).toBeInTheDocument();
    expect(screen.queryByText('Updating chart…')).not.toBeInTheDocument();
  });
});

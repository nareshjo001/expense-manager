import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

jest.mock('../../imports/chartsImport', () => ({
  PieChartWrapper: () => <div data-testid="mock-pie-chart-wrapper" />,
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

describe('PieChartPage -- explicit query states (FE-001-T07)', () => {
  beforeEach(() => {
    useChartInsights.mockReturnValue(mockChartInsights());
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

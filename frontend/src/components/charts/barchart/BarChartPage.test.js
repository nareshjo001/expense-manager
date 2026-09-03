import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BarChartPage from './BarChartPage';
import { useBarChartQuery } from '../../../hooks/queries/useBarChartQuery';
import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';

// FE-001 -- BarChartPage must show an explicit loading/error(+retry)/empty
// state instead of silently rendering nothing (the pre-FE-001 behavior for
// every one of those three situations was an identical blank area).
jest.mock('../../../hooks/queries/useBarChartQuery', () => ({
  useBarChartQuery: jest.fn(),
}));

jest.mock('../../contexts/ai-contexts/ChartInsightsContext', () => ({
  useChartInsights: jest.fn(),
}));

jest.mock('../../imports/chartsImport', () => ({
  ThemeContext: require('react').createContext('light-theme'),
  BarChartWrapper: () => <div data-testid="mock-bar-chart-wrapper" />,
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

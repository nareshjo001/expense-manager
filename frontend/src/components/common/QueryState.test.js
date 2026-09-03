import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import QueryState from './QueryState';

afterEach(() => {
  cleanup();
});

// FE-001 -- QueryState must render exactly one of loading/error/empty/content,
// never a mix, and must expose distinct accessible roles for each.
describe('QueryState', () => {
  it('renders the loading state with role="status" when isLoading is true', () => {
    render(
      <QueryState isLoading isError={false} isEmpty={false} loadingLabel="Loading things...">
        <div data-testid="content" />
      </QueryState>
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading things...');
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('renders the error state with role="alert" and a retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    render(
      <QueryState
        isLoading={false}
        isError
        isEmpty={false}
        onRetry={onRetry}
        errorLabel="It broke."
      >
        <div data-testid="content" />
      </QueryState>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('It broke.');
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button entirely when onRetry is not provided', () => {
    render(
      <QueryState isLoading={false} isError isEmpty={false} errorLabel="It broke.">
        <div data-testid="content" />
      </QueryState>
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders the empty state (not the error state) when isEmpty is true and isError is false', () => {
    render(
      <QueryState
        isLoading={false}
        isError={false}
        isEmpty
        emptyLabel="Nothing here."
        emptyHint="Add something."
      >
        <div data-testid="content" />
      </QueryState>
    );

    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.getByText('Add something.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('renders children unchanged when none of loading/error/empty apply', () => {
    render(
      <QueryState isLoading={false} isError={false} isEmpty={false}>
        <div data-testid="content">Real content</div>
      </QueryState>
    );

    expect(screen.getByTestId('content')).toHaveTextContent('Real content');
  });

  it('prioritizes loading over error and empty when multiple flags are somehow true', () => {
    render(
      <QueryState isLoading isError isEmpty loadingLabel="Loading first">
        <div data-testid="content" />
      </QueryState>
    );

    expect(screen.getByText('Loading first')).toBeInTheDocument();
  });
});

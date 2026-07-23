import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import reportWebVitals from './reportWebVitals';
import ScrollToTopButton from './components/alertsEffects/ScrollToTopButton';

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Create the React root
const root = ReactDOM.createRoot(document.getElementById('root'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

root.render(
  <React.StrictMode>
    {/*
      StrictMode helps detect:
      - unsafe lifecycle usage
      - side-effect issues in development
      - deprecated APIs

      It runs certain lifecycle logic twice in DEV only (not production),
      which is intentional and useful.
    */}
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
    
    <Analytics />
    <SpeedInsights />
    {/*
      ScrollToTopButton is mounted globally so:
      - it persists across route changes
      - it does not remount on page navigation
      - it remains independent of page-level layouts
    */}
    <ScrollToTopButton />
  </React.StrictMode>
);

/*
  Performance reporting hook.
  Currently inactive (no callback passed),
  but safe to keep for future analytics or profiling.
*/
reportWebVitals();
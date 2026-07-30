import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import reportWebVitals from './reportWebVitals';
import ScrollToTopButton from './components/alertsEffects/ScrollToTopButton';

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query/queryClient";

// App entry point: mounts the root providers (react-query, analytics) and the persistent scroll-to-top button.
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>

    <Analytics />
    <SpeedInsights />
    <ScrollToTopButton />
  </React.StrictMode>
);

// Inactive by default (no callback passed) — kept so a reporting callback can be wired in later.
reportWebVitals();
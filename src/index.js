import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import reportWebVitals from './reportWebVitals';
import ScrollToTopButton from './components/alertsEffects/ScrollToTopButton';

// Create the React root
const root = ReactDOM.createRoot(document.getElementById('root'));

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
    <App />
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
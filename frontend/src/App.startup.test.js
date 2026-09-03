import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { refreshAccessToken } from "./api/sessionClient";

const originalFetch = global.fetch;

jest.mock("./api/sessionClient", () => ({ refreshAccessToken: jest.fn() }));
jest.mock("./components/hooks/useWebPush", () => ({
  useWebPush: () => ({
    showNotificationPrompt: false,
    showDetailedPreviews: false,
    setShowDetailedPreviews: jest.fn(),
    handleEnable: jest.fn(),
    handleLater: jest.fn(),
  }),
}));
jest.mock("./components/hooks/useMobilePush", () => ({ useNativePush: jest.fn() }));
jest.mock("react-router-dom", () => ({ BrowserRouter: ({ children }) => <>{children}</> }), { virtual: true });
jest.mock("react-toastify", () => ({ ToastContainer: () => null }));
jest.mock("./components/ErrorBoundary", () => ({ children }) => <>{children}</>);
jest.mock("./components/sia/SiaLauncherContext", () => ({
  SiaLauncherProvider: ({ children }) => <>{children}</>,
}));
jest.mock("./imports/Imports", () => ({
  ThemeProvider: ({ children }) => <>{children}</>,
  SplashScreen: () => <div data-testid="startup-status">Loading</div>,
  Spinner: () => null,
  Login: () => <div data-testid="login-screen">Login</div>,
  SignUp: () => <div>Sign up</div>,
  ExpenseInsightsProvider: ({ children }) => <>{children}</>,
  ChartInsightsProvider: ({ children }) => <>{children}</>,
  LandingPage: () => <div data-testid="authenticated-app">Expenses</div>,
  expenseAddErrorToast: jest.fn(),
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe("application startup", () => {
  it("shows the splash only while the real session initialization is pending", async () => {
    const session = deferred();
    refreshAccessToken.mockReturnValue(session.promise);

    render(<App />);

    expect(screen.getByTestId("startup-status")).toBeInTheDocument();
    expect(screen.queryByTestId("login-screen")).not.toBeInTheDocument();
    session.resolve(null);

    expect(await screen.findByTestId("login-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("startup-status")).not.toBeInTheDocument();
  });

  it("renders the authenticated application as soon as session initialization succeeds", async () => {
    refreshAccessToken.mockResolvedValue({ token: "short-lived-access-token" });

    render(<App />);

    expect(await screen.findByTestId("authenticated-app")).toBeInTheDocument();
    expect(screen.queryByTestId("startup-status")).not.toBeInTheDocument();
  });
});

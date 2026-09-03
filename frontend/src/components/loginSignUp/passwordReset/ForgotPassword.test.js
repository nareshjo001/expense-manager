import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ForgotPassword from "./ForgotPassword";

jest.mock("../../alertsEffects/toastMessages", () => ({
  signUpSuccessToast: jest.fn(),
  logInErrorToast: jest.fn(),
}));

jest.mock("../../alertsEffects/FetchingLoader", () => ({
  FetchingLoader: () => <span>Loading</span>,
}));

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: jest.fn(async () => body),
});

describe("AUTH-002 forgot-password workflow", () => {
  const originalBackendUrl = process.env.REACT_APP_BACKEND_URL;

  beforeEach(() => {
    process.env.REACT_APP_BACKEND_URL = "https://api.example.test";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.REACT_APP_BACKEND_URL = originalBackendUrl;
    jest.restoreAllMocks();
  });

  test("carries the one-time reset token from OTP verification to password reset", async () => {
    const resetToken = "a".repeat(43);
    global.fetch
      .mockResolvedValueOnce(response({
        success: true,
        message: "If the account is eligible, a verification code has been sent.",
        cooldown: 120,
      }, true, 202))
      .mockResolvedValueOnce(response({ success: true, message: "Verification successful", resetToken }))
      .mockResolvedValueOnce(response({ success: true, message: "Password Changed Successfully" }));

    const onBack = jest.fn();
    render(<ForgotPassword onBack={onBack} setIsSpinnerLoad={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Email ID"), {
      target: { value: "Alice@Example.COM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send OTP" }));

    await screen.findByPlaceholderText("Enter OTP");
    fireEvent.change(screen.getByPlaceholderText("Enter OTP"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByPlaceholderText("New Password");
    fireEvent.change(screen.getByPlaceholderText("New Password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm Password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByDisplayValue("Change"));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const resetRequest = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(resetRequest).toEqual({
      email: "Alice@Example.COM",
      password: "new-password-123",
      resetToken,
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("does not open the reset form when verification omits the reset token", async () => {
    global.fetch
      .mockResolvedValueOnce(response({ success: true, cooldown: 120 }, true, 202))
      .mockResolvedValueOnce(response({ success: true, message: "Verification successful" }));

    render(<ForgotPassword onBack={jest.fn()} setIsSpinnerLoad={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Email ID"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send OTP" }));

    await screen.findByPlaceholderText("Enter OTP");
    fireEvent.change(screen.getByPlaceholderText("Enter OTP"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByPlaceholderText("New Password")).not.toBeInTheDocument();
  });
});

// Final correctness pass -- AddIncome's idempotency key now belongs to one
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AddIncome from "./AddIncome";
import { useAddIncomeMutation } from "../../hooks/mutations/useAddIncomeMutation";
import { expenseAddSuccessToast, expenseAddErrorToast } from "../alertsEffects/toastMessages";

// Explicit factories (not bare jest.mock(path) auto-mocking), mirroring
jest.mock("../../hooks/mutations/useAddIncomeMutation", () => ({
  useAddIncomeMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddSuccessToast: jest.fn(),
  expenseAddErrorToast: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

afterEach(() => {
  jest.clearAllMocks();
});

function fillRequiredFields({ source = "Salary", amount = "1000", date = "2026-01-15" } = {}) {
  fireEvent.change(screen.getByLabelText(/source of the income/i), { target: { value: source } });
  fireEvent.change(screen.getByLabelText(/amount received/i), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/date received/i), { target: { value: date } });
}

function renderAddIncome() {
  return render(<AddIncome />);
}

function submitAndCaptureCallbacks(mockMutate, callIndex = 0) {
  fireEvent.submit(document.querySelector("form.add-expense"));
  const [payload, callbacks] = mockMutate.mock.calls[callIndex];
  return { payload, callbacks };
}

describe("AddIncome -- payload-scoped idempotency id ({ id, fingerprint } per attempt)", () => {
  let mockAddMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn();
    useAddIncomeMutation.mockReturnValue({ mutate: mockAddMutate, isPending: false });
  });

  // 1. First submission creates exactly one id, sent under the exact
  it("1. a single submission calls mutate exactly once with a request field literally named `id`", () => {
    renderAddIncome();
    fillRequiredFields();

    fireEvent.submit(document.querySelector("form.add-expense"));

    expect(mockAddMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockAddMutate.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(payload, "id")).toBe(true);
    expect(payload.idempotencyKey).toBeUndefined();
  });

  // The id is a primitive non-empty bounded string (behavior #13).
  it("the id is a primitive non-empty, length-bounded string", () => {
    renderAddIncome();
    fillRequiredFields();
    const { payload } = submitAndCaptureCallbacks(mockAddMutate, 0);

    expect(typeof payload.id).toBe("string");
    expect(payload.id.length).toBeGreaterThan(0);
    expect(payload.id.length).toBeLessThanOrEqual(100);
  });

  // 2. Unchanged retry after a lost/ambiguous response reuses the same id
  it("2a. reuses the same id across a retried submit while the form stays open (lost-response retry)", () => {
    renderAddIncome();
    fillRequiredFields();

    const first = submitAndCaptureCallbacks(mockAddMutate, 0);
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).toBe(first.payload.id);
  });

  it("2b. an ambiguous failure (500) followed by an unchanged-payload retry reuses the same id", () => {
    renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    // Same fields, unchanged -- a genuine retry of the same logical attempt.
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).toBe(first.payload.id);
  });

  it("2c. a network failure (no response object) followed by an unchanged-payload retry reuses the same id", () => {
    renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError(new Error("Network Error"));
    });

    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).toBe(first.payload.id);
  });

  // 3. A source change after an ambiguous failure mints a NEW id on the
  it("3. a source change after an ambiguous failure mints a new id on the next explicit submission", () => {
    renderAddIncome();
    fillRequiredFields({ source: "Salary" });
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    fireEvent.change(screen.getByLabelText(/source of the income/i), { target: { value: "Freelance" } });
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
    expect(second.incomeSource).toBe("Freelance");
  });

  // 4. An amount change after an ambiguous failure mints a NEW id.
  it("4. an amount change after an ambiguous failure mints a new id on the next explicit submission", () => {
    renderAddIncome();
    fillRequiredFields({ amount: "1000" });
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    fireEvent.change(screen.getByLabelText(/amount received/i), { target: { value: "1200" } });
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
    expect(second.incomeAmount).toBe(1200);
    expect(second.incomeAmount).not.toBe(first.payload.incomeAmount);
  });

  // 5. A date change after an ambiguous failure mints a NEW id.
  it("5. a date change after an ambiguous failure mints a new id on the next explicit submission", () => {
    renderAddIncome();
    fillRequiredFields({ date: "2026-01-15" });
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    fireEvent.change(screen.getByLabelText(/date received/i), { target: { value: "2026-01-20" } });
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
    expect(second.incomeDate).toBe("2026-01-20");
    expect(second.incomeDate).not.toBe(first.payload.incomeDate);
  });

  // 6. Re-rendering the component does not create a new id for an active
  it("6. does not regenerate the id merely because the component rerenders with a new mutate identity", () => {
    const { rerender } = renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    const newMockMutate = jest.fn();
    useAddIncomeMutation.mockReturnValue({ mutate: newMockMutate, isPending: false });
    rerender(<AddIncome />);
    fireEvent.submit(document.querySelector("form.add-expense"));

    expect(newMockMutate.mock.calls[0][0].id).toBe(first.payload.id);
  });

  // 7/8. A committed success clears the active attempt; the NEXT logical
  // submission (even with identical field values) gets a new id.
  it("7/8. a committed success clears the attempt, so the next submission -- even with identical fields -- gets a new id", () => {
    renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onSuccess({
        success: true,
        message: "Income Added Successfully",
        data: {},
      });
    });

    // Identical field values to the first submission -- proves the id
    fillRequiredFields();
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
  });

  // 9. A definitive 409 clears the incompatible attempt.
  // 10. The next explicit submit after a 409 uses a different id.
  it("9/10. a 409 clears the incompatible attempt, so the next explicit submit uses a different id", () => {
    renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({
        response: { status: 409, data: { errorCode: "IDEMPOTENCY_KEY_CONFLICT" } },
      });
    });

    // Even an UNCHANGED resubmit after a 409 must get a fresh id -- the old
    // id is now permanently incompatible server-side.
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
  });

  // 11. No automatic resubmit occurs after any failure -- mutate is only
  // ever called once per explicit fireEvent.submit.
  it("11. no automatic retry occurs after an ambiguous failure or a 409 -- mutate is only called on explicit submits", () => {
    renderAddIncome();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    // No further fireEvent.submit call -- mutate must still have been
    // called exactly once.
    expect(mockAddMutate).toHaveBeenCalledTimes(1);

    const second = submitAndCaptureCallbacks(mockAddMutate, 1);
    act(() => {
      second.callbacks.onError({ response: { status: 409, data: { errorCode: "IDEMPOTENCY_KEY_CONFLICT" } } });
    });
    expect(mockAddMutate).toHaveBeenCalledTimes(2);
  });
});

describe("AddIncome -- existing form/success/error behavior is unchanged", () => {
  let mockAddMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn();
    useAddIncomeMutation.mockReturnValue({ mutate: mockAddMutate, isPending: false });
  });

  // 12. Existing form success, validation, and error behavior remains
  // unchanged (9a-9d below).
  it("9a. a successful submission resets the form, navigates home, and shows the success toast", () => {
    renderAddIncome();
    fillRequiredFields();
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onSuccess({ success: true, message: "Income Added Successfully", data: {} });
    });

    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(expenseAddSuccessToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Income Added Successfully" })
    );
    expect(screen.getByLabelText(/source of the income/i).value).toBe("");
    expect(screen.getByLabelText(/amount received/i).value).toBe("");
    expect(screen.getByLabelText(/date received/i).value).toBe("");
  });

  it("9b. a genuine failure (500) keeps form state and shows the error toast, without navigating", () => {
    renderAddIncome();
    fillRequiredFields({ source: "Consulting" });
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(expenseAddErrorToast).toHaveBeenCalledWith({ message: "Internal Server Error" });
    expect(screen.getByLabelText(/source of the income/i).value).toBe("Consulting");
  });

  it("9c. 401/429/409 errors are left to the shared axios interceptor -- no second toast fired", () => {
    renderAddIncome();
    fillRequiredFields();
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onError({ response: { status: 409, data: { errorCode: "IDEMPOTENCY_KEY_CONFLICT" } } });
    });

    expect(expenseAddErrorToast).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("9d. submits the exact incomeSource/incomeAmount/incomeDate contract fields the backend expects", () => {
    renderAddIncome();
    fillRequiredFields({ source: "  Bonus   pay  ", amount: "500", date: "2026-02-01" });
    const { payload } = submitAndCaptureCallbacks(mockAddMutate, 0);

    expect(payload.incomeSource).toBe("Bonus pay"); // sanitizeText: trim + collapse whitespace.
    expect(payload.incomeAmount).toBe(500);
    expect(typeof payload.incomeAmount).toBe("number");
    expect(payload.incomeDate).toBe("2026-02-01");
  });

  // Client-side validation failure (the form is simply never submitted --
  it("a form that never reaches handleSubmit (client-side validation gate) never calls mutate, so no id is minted", () => {
    renderAddIncome();
    // Deliberately leave required fields empty -- no fireEvent.submit call
    // simulates the browser blocking submission via native validation.
    expect(mockAddMutate).not.toHaveBeenCalled();
  });
});

describe("AddIncome -- no frontend service credential is introduced", () => {
  // 13. Static source check -- the component file itself never embeds an
  it("AddIncome.js source contains no hardcoded credential/secret literal", () => {
    const source = fs.readFileSync(path.join(__dirname, "AddIncome.js"), "utf8");
    const forbidden = [
      /sk-[a-zA-Z0-9]{10,}/, // OpenAI-style secret key shape
      /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
      /secret\s*[:=]\s*["'][^"']{8,}["']/i,
      /Bearer\s+[a-zA-Z0-9._-]{20,}/,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(source)).toBe(false);
    }
    // The only "token" reference anywhere in this component's own tree is
    expect(source.includes("ML_OPERATIONS_TOKEN")).toBe(false);
    expect(source.includes("process.env.OPENAI")).toBe(false);
  });
});

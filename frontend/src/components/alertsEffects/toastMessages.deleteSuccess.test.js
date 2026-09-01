// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
import { toast } from "react-toastify";
import { deleteSuccessToast } from "./toastMessages";

jest.mock("react-toastify", () => ({
  toast: {
    dismiss: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  },
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe("deleteSuccessToast", () => {
  it("defaults to the original 'Deleted Successfully!' text when called with no argument (backward compatible)", () => {
    deleteSuccessToast();

    const [node] = toast.success.mock.calls[0];
    expect(node.props.children.props.children).toBe("Deleted Successfully!");
  });

  it("shows the original text when explicitly called with isPending:false", () => {
    deleteSuccessToast(false);

    const [node] = toast.success.mock.calls[0];
    expect(node.props.children.props.children).toBe("Deleted Successfully!");
  });

  it("shows calm, non-alarming 'still refreshing' wording when isPending:true, never implying failure or asking for resubmission", () => {
    deleteSuccessToast(true);

    const [node] = toast.success.mock.calls[0];
    const text = node.props.children.props.children;
    expect(text).toBe("Expense deleted. Budget and insights are still refreshing.");
    expect(text.toLowerCase()).not.toMatch(/fail|error|resubmit|try again|fraud|security/);
  });
});

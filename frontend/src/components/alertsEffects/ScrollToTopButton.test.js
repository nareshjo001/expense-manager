import { render, screen, fireEvent, act } from "@testing-library/react";
import ScrollToTopButton from "./ScrollToTopButton";

describe("ScrollToTopButton", () => {
  beforeEach(() => {
    window.scrollY = 0;
    window.scrollTo = jest.fn();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("does not render when window.scrollY <= 300", () => {
    render(<ScrollToTopButton />);
    expect(screen.queryByRole("button", { name: /top/i })).not.toBeInTheDocument();
  });

  it("renders when window.scrollY > 300", () => {
    render(<ScrollToTopButton />);
    act(() => {
      window.scrollY = 350;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("button", { name: /top/i })).toBeInTheDocument();
  });

  it("does not render on .notification-prefs-page even when scrolled > 300", () => {
    const page = document.createElement("div");
    page.className = "notification-prefs-page";
    document.body.appendChild(page);

    render(<ScrollToTopButton />);
    act(() => {
      window.scrollY = 450;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("button", { name: /top/i })).not.toBeInTheDocument();
  });

  it("scrolls to top when clicked", () => {
    render(<ScrollToTopButton />);
    act(() => {
      window.scrollY = 400;
      window.dispatchEvent(new Event("scroll"));
    });

    const button = screen.getByRole("button", { name: /top/i });
    fireEvent.click(button);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DataTransfer from "./DataTransfer";

let mockLocation = { pathname: "/data-transfer", search: "" };
const mockNavigate = jest.fn();

// react-router-dom isn't resolvable under this repo's Jest 27 CJS environment
// without a virtual mock (consistent with other tests in this codebase).
jest.mock(
  "react-router-dom",
  () => ({
    useLocation: () => mockLocation,
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

jest.mock("../importWizard/ImportWizard", () => () => <div data-testid="import-wizard-view">Import Wizard View</div>);
jest.mock("../dataExport/DataExport", () => () => <div data-testid="data-export-view">Data Export View</div>);

describe("DataTransfer -- Import / Export unified toggle", () => {
  beforeEach(() => {
    mockLocation = { pathname: "/data-transfer", search: "" };
    mockNavigate.mockClear();
  });

  it("defaults to Import tab and marks that half as pressed with slide-in wrapper", () => {
    const { container } = render(<DataTransfer />);

    expect(screen.getByTestId("import-wizard-view")).toBeInTheDocument();
    expect(screen.queryByTestId("data-export-view")).toBeNull();

    const panel = container.querySelector(".data-transfer-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("add-expense-wrapper");

    const importBtn = screen.getByRole("button", { name: "Import" });
    const exportBtn = screen.getByRole("button", { name: "Export" });

    expect(importBtn).toHaveAttribute("aria-pressed", "true");
    expect(importBtn).toHaveClass("active");
    expect(exportBtn).toHaveAttribute("aria-pressed", "false");
    expect(exportBtn).not.toHaveClass("active");

    const slider = container.querySelector(".form-toggle-slider");
    expect(slider).not.toHaveClass("right");
  });

  it("activates Export tab when initialTab='export' is supplied with slide-in wrapper", () => {
    const { container } = render(<DataTransfer initialTab="export" />);

    expect(screen.getByTestId("data-export-view")).toBeInTheDocument();
    expect(screen.queryByTestId("import-wizard-view")).toBeNull();

    const panel = container.querySelector(".data-transfer-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("add-expense-wrapper");

    const importBtn = screen.getByRole("button", { name: "Import" });
    const exportBtn = screen.getByRole("button", { name: "Export" });

    expect(exportBtn).toHaveAttribute("aria-pressed", "true");
    expect(exportBtn).toHaveClass("active");
    expect(importBtn).toHaveAttribute("aria-pressed", "false");

    const slider = container.querySelector(".form-toggle-slider");
    expect(slider).toHaveClass("right");
  });

  it("activates Export tab when pathname is /export", () => {
    mockLocation = { pathname: "/export", search: "" };
    const { container } = render(<DataTransfer />);

    expect(screen.getByTestId("data-export-view")).toBeInTheDocument();
    expect(screen.queryByTestId("import-wizard-view")).toBeNull();

    const exportBtn = screen.getByRole("button", { name: "Export" });
    expect(exportBtn).toHaveAttribute("aria-pressed", "true");
    expect(exportBtn).toHaveClass("active");

    const slider = container.querySelector(".form-toggle-slider");
    expect(slider).toHaveClass("right");
  });

  it("activates Export tab when ?tab=export search param is present", () => {
    mockLocation = { pathname: "/data-transfer", search: "?tab=export" };
    render(<DataTransfer />);

    expect(screen.getByTestId("data-export-view")).toBeInTheDocument();
    expect(screen.queryByTestId("import-wizard-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to Export and back to Import when buttons are clicked with slide-in wrapper", () => {
    const { container } = render(<DataTransfer />);

    const slider = container.querySelector(".form-toggle-slider");
    const importBtn = screen.getByRole("button", { name: "Import" });
    const exportBtn = screen.getByRole("button", { name: "Export" });

    // Click Export
    fireEvent.click(exportBtn);

    expect(screen.getByTestId("data-export-view")).toBeInTheDocument();
    expect(screen.queryByTestId("import-wizard-view")).toBeNull();
    expect(container.querySelector(".data-transfer-panel")).toHaveClass("add-expense-wrapper");
    expect(exportBtn).toHaveAttribute("aria-pressed", "true");
    expect(exportBtn).toHaveClass("active");
    expect(slider).toHaveClass("right");
    expect(mockNavigate).toHaveBeenCalledWith("/data-transfer?tab=export", { replace: true });

    // Click Import
    fireEvent.click(importBtn);

    expect(screen.getByTestId("import-wizard-view")).toBeInTheDocument();
    expect(screen.queryByTestId("data-export-view")).toBeNull();
    expect(container.querySelector(".data-transfer-panel")).toHaveClass("add-expense-wrapper");
    expect(importBtn).toHaveAttribute("aria-pressed", "true");
    expect(importBtn).toHaveClass("active");
    expect(slider).not.toHaveClass("right");
    expect(mockNavigate).toHaveBeenCalledWith("/data-transfer?tab=import", { replace: true });
  });
});

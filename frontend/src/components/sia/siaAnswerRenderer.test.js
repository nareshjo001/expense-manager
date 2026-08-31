import React from "react";
import { render, screen } from "@testing-library/react";
import { renderSiaAnswer } from "./siaAnswerRenderer";

describe("renderSiaAnswer", () => {
  it("renders bold text and bullet lists without Markdown markers", () => {
    render(<div>{renderSiaAnswer("**Current Budget Overview**\n\n- **Total Budget:** ₹4,000\n- **Status:** Critical")}</div>);

    expect(screen.getByText("Current Budget Overview").tagName).toBe("STRONG");
    expect(screen.getByText("Total Budget:").tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("renders Markdown tables as an accessible table", () => {
    render(<div>{renderSiaAnswer("| Module | Score |\n| --- | --- |\n| **Budget** | 9.56/50 |")}</div>);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Module" })).toBeInTheDocument();
    expect(screen.getByText("Budget").tagName).toBe("STRONG");
    expect(screen.queryByText(/---/)).not.toBeInTheDocument();
  });

  it("keeps HTML-looking provider text inert", () => {
    render(<div>{renderSiaAnswer("<script>alert('x')</script>")}</div>);

    expect(screen.getByText("<script>alert('x')</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});

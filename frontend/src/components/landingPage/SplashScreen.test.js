import React from "react";
import fs from "fs";
import path from "path";
import { render, screen } from "@testing-library/react";
import SplashScreen from "./SplashScreen";

describe("startup splash accessibility", () => {
  it("announces initialization without exposing decorative layers", () => {
    const { container } = render(<SplashScreen />);

    expect(screen.getByRole("status", { name: "Loading Balensia" })).toBeInTheDocument();
    expect(container.querySelector(".stage")).toHaveAttribute("aria-hidden", "true");
  });

  it("disables continuous splash animation when reduced motion is requested", () => {
    const css = fs.readFileSync(path.join(__dirname, "SplashScreen.css"), "utf8");

    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/\.layer\s*\{\s*animation:\s*none;/);
  });
});

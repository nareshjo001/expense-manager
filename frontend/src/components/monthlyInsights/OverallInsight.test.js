// ANL-001-T04/T05 -- OverallInsight previously had no test file. The
// stability card's buildStability() now prefers the backend-computed
// report.insights.stability (verified byte-identical formula/thresholds to
// the pre-existing client-side computation from report.spending.stability)
// and falls back to the original client-side computation for reports that
// predate that backend field. This proves both paths are actually wired up
// -- not just "looks right" -- by using a case where the two sources would
// disagree if the backend value were being ignored.
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import OverallInsight from "./OverallInsight";

// react-intersection-observer's useInView needs no real IntersectionObserver
// for this component -- it only gates an animation class on the streak
// number, not content.
jest.mock("react-intersection-observer", () => ({
  useInView: () => ({ ref: jest.fn(), inView: true }),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("monthlyInsights/OverallInsight -- ANL-001-T04 stability card", () => {
  it("uses report.insights.stability's score/tier when hasData is true, NOT a recompute from report.spending.stability", () => {
    const report = {
      spending: {
        // If the code wrongly recomputed from this instead of reading
        // report.insights.stability, coefficientOfVariation 0.5 would
        // produce score 50 / "Moderately Stable" -- a different label
        // than the backend value below, so this proves which source wins.
        stability: { coefficientOfVariation: 0.5 },
      },
      insights: {
        stability: {
          hasData: true,
          coefficientOfVariation: 0.1,
          score: 90,
          tier: "HighlyStable",
        },
      },
    };

    render(<OverallInsight report={report} />);

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Highly Stable")).toBeInTheDocument();
    expect(screen.getByText("Your daily spending is very consistent.")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.queryByText("Moderately Stable")).not.toBeInTheDocument();
  });

  it("maps each backend tier code to the same existing display label/message", () => {
    const cases = [
      { tier: "HighlyStable", score: 80, label: "Highly Stable", message: "Your daily spending is very consistent." },
      { tier: "ModeratelyStable", score: 60, label: "Moderately Stable", message: "Your daily spending is fairly consistent." },
      { tier: "LowStability", score: 20, label: "Low Stability", message: "Your spending varies a lot day to day." },
    ];

    cases.forEach(({ tier, score, label, message }) => {
      const report = {
        spending: {},
        insights: { stability: { hasData: true, coefficientOfVariation: null, score, tier } },
      };

      const { unmount } = render(<OverallInsight report={report} />);

      expect(screen.getByText(`${score}%`)).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();

      unmount();
    });
  });

  it("falls back to computing from report.spending.stability when report.insights.stability.hasData is false", () => {
    const report = {
      spending: { stability: { coefficientOfVariation: 0.1 } }, // -> score 90, Highly Stable
      insights: { stability: { hasData: false, coefficientOfVariation: null, score: null, tier: null } },
    };

    render(<OverallInsight report={report} />);

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Highly Stable")).toBeInTheDocument();
    expect(screen.getByText("Your daily spending is very consistent.")).toBeInTheDocument();
  });

  it("falls back to computing from report.spending.stability when report.insights is entirely absent (legacy cached report)", () => {
    const report = {
      spending: { stability: { coefficientOfVariation: 0.6 } }, // -> score 40, Low Stability
      // no `insights` key at all
    };

    render(<OverallInsight report={report} />);

    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Low Stability")).toBeInTheDocument();
    expect(screen.getByText("Your spending varies a lot day to day.")).toBeInTheDocument();
  });

  it("falls back to computing from report.spending.stability when report.insights is {} (schema default for pre-ANL-001 reports)", () => {
    const report = {
      spending: { stability: { coefficientOfVariation: 0.3 } }, // -> score 70, Moderately Stable
      insights: {},
    };

    render(<OverallInsight report={report} />);

    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("Moderately Stable")).toBeInTheDocument();
  });

  it("renders the existing empty state when neither report.insights.stability nor report.spending.stability has usable data", () => {
    const report = {
      spending: { stability: { coefficientOfVariation: null } },
      insights: { stability: { hasData: false, coefficientOfVariation: null, score: null, tier: null } },
    };

    render(<OverallInsight report={report} />);

    expect(screen.getByText("We're still learning your spending")).toBeInTheDocument();
    expect(screen.getByText("Add more transactions to analyze your spending consistency")).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

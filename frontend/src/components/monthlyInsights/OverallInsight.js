import { useMemo } from 'react';
// DAT-001-T06 -- money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import './OverallInsight.css';
import { FaArrowRight, FaCrown, FaShieldAlt } from "react-icons/fa";
import { FaArrowTrendUp } from "react-icons/fa6";
import { useInView } from 'react-intersection-observer';

// Derives the biggest spending jump, budget streak, and stability score cards from the report data.
function buildSpendingJump(categoriesMonthly) {
  const jump = categoriesMonthly?.biggestJump;
  if (!jump?.category || !Number.isFinite(jump?.growthPercentage) || jump.growthPercentage <= 0) {
    return null;
  }
  return {
    type: "SPENDING_SPIKE",
    message: `${jump.category} spending jumped compared to last month.`,
    subMessage: `Up by ₹${Math.round(jump.change ?? 0)} month-over-month.`,
    data: {
      increasePercent: Math.round(jump.growthPercentage * 100) / 100,
      previousAmount: jump.previous ?? 0,
      currentAmount: jump.current ?? 0,
    },
  };
}

function buildStreak(budgets) {
  if (!budgets?.hasBudget) return { streak: 0 };
  return { streak: budgets.currentStreak ?? 0 };
}

// ANL-001-T04 -- backend tier codes ("HighlyStable" etc, from
// stabilityScoreAnalyzer.js) map to the same display labels/messages this
// component has always shown.
const STABILITY_TIER_LABELS = {
  HighlyStable: { label: "Highly Stable", message: "Your daily spending is very consistent." },
  ModeratelyStable: { label: "Moderately Stable", message: "Your daily spending is fairly consistent." },
  LowStability: { label: "Low Stability", message: "Your spending varies a lot day to day." },
};

// ANL-001-T04 -- prefers report.insights.stability (backend-computed by
// stabilityScoreAnalyzer.js) when it has data: verified byte-for-byte
// identical formula/thresholds to the client-side computation below
// (Math.max(0, Math.min(100, Math.round(100 - cov * 100))), 75/50 cutoffs),
// so this is a genuine 1:1 swap, not an approximation. Falls back to
// recomputing from report.spending.stability, UNCHANGED, for reports
// generated before ANL-001-T03/T04 added backend insights.
function buildStability(spending, insightsStability) {
  if (insightsStability?.hasData) {
    const tier = STABILITY_TIER_LABELS[insightsStability.tier];
    if (tier && Number.isFinite(insightsStability.score)) {
      return { stabilityScore: insightsStability.score, stabilityInsight: tier };
    }
  }

  const stability = spending?.stability;
  if (!stability || !Number.isFinite(stability.coefficientOfVariation)) return null;
  const score = Math.max(0, Math.min(100, Math.round(100 - stability.coefficientOfVariation * 100)));
  let label = "Low Stability";
  let message = "Your spending varies a lot day to day.";
  if (score >= 75) {
    label = "Highly Stable";
    message = "Your daily spending is very consistent.";
  } else if (score >= 50) {
    label = "Moderately Stable";
    message = "Your daily spending is fairly consistent.";
  }
  return { stabilityScore: score, stabilityInsight: { label, message } };
}

export default function OverallInsight({ report, hide = false }) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.5 });

  const insight = useMemo(() => ({
    biggestSpendingJump: buildSpendingJump(report?.categories?.monthly),
    streak: buildStreak(report?.budgets),
    stabilityDetails: buildStability(report?.spending, report?.insights?.stability),
  }), [report]);

  if (hide) return null;

  return (
    <>
      {/* Card 4: Biggest Spending Jump */}
      <div className="spending-insights-card overall-insights-card spending-jump">
        <div className="spending-insights-card-head overall-insights-card-head spending-jump-head">
          <div className="spending-card-icon-badge badge-jump" aria-hidden="true">
            <FaArrowTrendUp size={16} />
          </div>
          <div className="spending-card-head-text">
            <h3 className="spending-card-title overall-insights-h-text">Biggest Spending Jump</h3>
          </div>
        </div>

        {insight.biggestSpendingJump?.type === "SPENDING_SPIKE" ? (
          <div className="spending-card-body overall-insights-card-body spending-jump-body">
            <p className="spending-card-desc overall-insights-p-text jump-message">
              {insight.biggestSpendingJump.message}
            </p>
            <div className="spending-jump-box spending-jump-body-time-card">
              <h4 className="spending-jump-percent overall-insights-h-text">
                +{insight.biggestSpendingJump.data.increasePercent}%
              </h4>
              <p className="spending-jump-range overall-insights-p-text p-wrapper">
                {formatMoney(insight.biggestSpendingJump.data.previousAmount)}
                <span> <FaArrowRight size={12} /> </span>
                <strong style={{ fontWeight: "bold", fontSize: "15px" }}>
                  {formatMoney(insight.biggestSpendingJump.data.currentAmount)}
                </strong>
              </p>
            </div>
            <p className="spending-jump-subtext overall-insights-p-text">
              {insight.biggestSpendingJump.subMessage}
            </p>
          </div>
        ) : (
          <div className="insights-empty-card overall-insights-empty-card">
            <p className="insights-empty-text">No major spending spikes detected.</p>
          </div>
        )}
      </div>

      {/* Card 5: Budget Streak */}
      <div className="spending-insights-card overall-insights-card budget-streak">
        <div className="spending-insights-card-head overall-insights-card-head budget-streak-head">
          <div className="spending-card-icon-badge badge-streak" aria-hidden="true">
            <FaCrown size={16} />
          </div>
          <div className="spending-card-head-text budget-streak-head-texts">
            <h3 className="spending-card-title overall-insights-h-text">Budget Streak</h3>
            <p className="spending-card-subtitle overall-insights-p-text">Achievement tracker</p>
          </div>
        </div>

        <div className="streak-card-body overall-insights-card-body budget-streak-body">
          <p className="streak-top-text overall-insights-p-text">
            {insight.streak.streak ? "You stayed within budget for" : "Your streak hasn't started yet"}
          </p>
          <div className="streak-center-wrap">
            <svg className="streak-confetti" width="90" height="48" viewBox="0 0 90 48" fill="none" aria-hidden="true">
              <line x1="14" y1="12" x2="22" y2="18" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="76" y1="12" x2="68" y2="18" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="10" y1="28" x2="19" y2="28" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="80" y1="28" x2="71" y2="28" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <h2
              ref={ref}
              className={`streak-number overall-insights-h-text ${!inView ? "hidden" : ""} ${inView ? "animate" : ""}`}
            >
              {insight.streak.streak}
            </h2>
          </div>
          <p className="streak-bottom-text overall-insights-p-text">
            {insight.streak.streak ? "consecutive months. Keep it up!" : "Stay within your budget to start your streak"}
          </p>
        </div>
      </div>

      {/* Card 6: Stability Score */}
      <div
        className="spending-insights-card overall-insights-card stability-score"
        title="Measures how consistent your daily spending is."
      >
        <div className="spending-insights-card-head overall-insights-card-head stability-score-head">
          <div className="spending-card-icon-badge badge-stability" aria-hidden="true">
            <FaShieldAlt size={16} />
          </div>
          <div className="spending-card-head-text">
            <h3 className="spending-card-title overall-insights-h-text">Stability Score</h3>
          </div>
        </div>

        {insight.stabilityDetails != null ? (
          <div className="stability-card-body overall-insights-card-body stability-score-body">
            <div
              className="stability-donut circle"
              style={{
                background: `conic-gradient(#be185d 0% ${insight.stabilityDetails.stabilityScore}%, #e2e8f0 ${insight.stabilityDetails.stabilityScore}% 100%)`
              }}
            >
              <div className="stability-donut-inner">
                <span>{insight.stabilityDetails.stabilityScore}%</span>
              </div>
            </div>
            <h4 className="stability-label overall-insights-h-text" style={{ fontSize: "15px", fontWeight: "700" }}>
              {insight.stabilityDetails.stabilityInsight.label}
            </h4>
            <p className="stability-desc overall-insights-p-text">
              {insight.stabilityDetails.stabilityInsight.message}
            </p>
          </div>
        ) : (
          <div className="insights-empty-card overall-insights-empty-card">
            <p className="insights-empty-title">We're still learning your spending</p>
            <p className="insights-empty-text">Add more transactions to analyze your spending consistency</p>
          </div>
        )}
      </div>
    </>
  );
}
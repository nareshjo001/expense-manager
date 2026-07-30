import { useMemo } from 'react';
import './OverallInsight.css';
import { FaFire, FaAward, FaArrowRight } from "react-icons/fa";
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

function buildStability(spending) {
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

export default function OverallInsight({ report }) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.5 });

  const insight = useMemo(() => ({
    biggestSpendingJump: buildSpendingJump(report?.categories?.monthly),
    streak: buildStreak(report?.budgets),
    stabilityDetails: buildStability(report?.spending),
  }), [report]);

  return (
    <div className='overall-insights-container'>
      <div className='overall-insights-card spending-jump'>
        <div className='overall-insights-card-head spending-jump-head'>
          <div className="heading-icon">
              <FaArrowTrendUp  size={18} color="#FFFFFF" />
          </div>
          <h1 className='overall-insights-h-text'>Biggest Spending Jump</h1>
        </div>

        {insight.biggestSpendingJump?.type === "SPENDING_SPIKE"
          ? (
            <div className='overall-insights-card-body spending-jump-body'>
              <p className='overall-insights-p-text jump-message'>{insight.biggestSpendingJump.message}</p>
              <div className='spending-jump-body-time-card'>
                <h1 className='overall-insights-h-text'>
                  +{insight.biggestSpendingJump.data.increasePercent}%
                </h1>
                <p className='overall-insights-p-text p-wrapper'>
                  ₹{insight.biggestSpendingJump.data.previousAmount}
                  <span> <FaArrowRight /> </span>
                  <span style={{fontWeight: "bold", fontSize: "16px"}}>₹{insight.biggestSpendingJump.data.currentAmount}</span>
                </p>
              </div>
              <p className='overall-insights-p-text' style={{ marginTop: "10px"}}>
                {insight.biggestSpendingJump.subMessage}
              </p>
            </div>
          )
          : (
            <div className='overall-insights-empty-card'>
              <p className='insights-empty-text'>No major spending spikes detected.</p>
            </div>
          )
        }
      </div>

      <div className='overall-insights-card budget-streak'>
        <div className='overall-insights-card-head budget-streak-head'>
          <div className="heading-icon">
              <FaFire size={18} color="#FFFFFF" />
          </div>
          <div className='budget-streak-head-texts'>
            <h1 className='overall-insights-h-text'>Budget Streak</h1>
            <p className='overall-insights-p-text'>Achievement tracker</p>
          </div>
        </div>

        <div className='overall-insights-card-body budget-streak-body'>
          <p className='overall-insights-p-text'>{insight.streak.streak ? `You stayed within budget for` : `Your streak hasn't started yet`}</p>
          <h1 
            ref={ref}
            className={`overall-insights-h-text streak-number ${!inView ? 'hidden' : ''} ${inView ? 'animate' : ''}`}
          >{insight.streak.streak}</h1>
          <p className='overall-insights-p-text'>{insight.streak.streak ? `consecutive months. Keep it up!` : 'Stay within your budget to start your streak'}</p>
        </div>   
      </div>

      <div className='overall-insights-card stability-score' title="Measures how consistent your daily spending is.">
        <div className='overall-insights-card-head stability-score-head'>
          <div className="heading-icon">
              <FaAward size={18} color="#FFFFFF" />
          </div>
          <h1 className='overall-insights-h-text'>Stability Score</h1>
        </div>

        {insight.stabilityDetails != null
          ? (
            <div className='overall-insights-card-body stability-score-body'>
              <div className='stability-score-percentage'>
                <div
                  className="circle"
                  style={{
                    background: `conic-gradient(
                      #14b8a6 0%,
                      #3b82f6 ${insight.stabilityDetails.stabilityScore}%,
                      #e5e7eb ${insight.stabilityDetails.stabilityScore}% 100%
                    )`
                  }}
                >
                  <span>{insight.stabilityDetails.stabilityScore}%</span>
                </div>
              </div>
              <h3 className='overall-insights-h-text' style={{color: "#374151", fontSize: "16px", fontWeight: "500"}}>{insight.stabilityDetails.stabilityInsight.label}</h3>
              <p className='overall-insights-p-text'>{insight.stabilityDetails.stabilityInsight.message}</p>
            </div>
          ) : (
            <div className='overall-insights-empty-card'>
              <p className='insights-empty-text'>We're still learning your spending</p>
              <p className='insights-empty-text'>Add more transactions to analyze your spending consistency</p>
            </div>
          )
        }
      </div>
    </div>
  )
}
import { FaLightbulb, FaExclamationTriangle, FaExclamationCircle, FaCheckCircle, FaMagic, FaFireAlt, FaBullseye } from "react-icons/fa";
import "./BudgetIntelligence.css";

const DEFAULT_INSIGHT = {
  type: "OTHERS",
  title: "No Budget Insights Yet",
  message: "Set a budget to start getting personalized insights.",
  tip: "Add a monthly budget to unlock smart tips.",
};

export default function BudgetIntelligence({ data }) {
  const icons = {
    EXCEEDED: <FaFireAlt  color="#e11d48" size={18} />,
    HIGH_RISK: <FaExclamationTriangle  color="#f97316" size={18} />,
    CRITICAL: <FaExclamationCircle  color="#dc2626" size={18} />,
    AT_RISK: <FaExclamationTriangle  color="#f97316" size={18} />,
    WARNING: <FaExclamationCircle color="#eab308" size={18} />,
    SAFE: <FaBullseye  color="#10b981" size={18} />,
    OTHERS: <FaLightbulb  color="#10b981" size={18} />,
  };

  const insights = data?.budgetInsights ?? DEFAULT_INSIGHT;
  const insightType = insights.type && icons[insights.type] ? insights.type : "OTHERS";
  const utilization = Number.isFinite(data?.utilization) ? data.utilization : 0;
  const spent = data?.spent ?? 0;
  const budget = data?.budget ?? 0;

  return (
    <div className="budget-intelligence-card">
      <div className="budget-intelligence-heading">
        <div className="heading-icon">
          <FaLightbulb size={18} color="#FFFFFF" />
        </div>
        <h1 className="budget-intelligence-h-text">Budget Intelligence</h1>
      </div>

      <div className={`budget-intelligence-report-card ${insightType}`}>
        <div className="budget-intelligence-report-heading">
          <div className="heading-icon" style={{background: "#F3F4F6"}}>
            {icons[insightType]}
          </div>
          <h1 className="budget-intelligence-h-text">{insights.title ?? DEFAULT_INSIGHT.title}</h1>
          <p className={`budget-intelligence-report-priority ${insightType}`}>
            {insightType.replace("_", " ")}
          </p>
        </div>

        <div className="budget-intelligence-report-insight">
          <p className="budget-intelligence-p-text">{insights.message ?? DEFAULT_INSIGHT.message}</p>

          {budget > 0 && (
            <div className="budget-intelligence-report-bar-container">
              <div className="budget-progress-header">
                <span className="budget-progress-title">Budget Progress</span>
                <span className="budget-progress-percent">
                  {Math.round(utilization)}%
                </span>
              </div>

              <div className="budget-intelligence-report-bar">
                <div className="progress-track">
                  <div
                    className={`progress-fill ${insightType}`}
                    style={{
                      width: `${Math.min(Math.max(utilization, 0), 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="budget-bar-labels">
                <span>₹ {spent}</span>
                <span>₹ {budget}</span>
              </div>
            </div>
          )}
        </div>

        <div className="budget-intelligence-smart-tip">
          <div className="budget-intelligence-smart-tip-label">
            <FaMagic style={{ color:"#d97706", fontSize:"16px"}}/>
            <h5>Smart Tip</h5>
          </div>
          <p>{insights.tip ?? DEFAULT_INSIGHT.tip}</p>
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import { FaLightbulb, FaExclamationTriangle, FaExclamationCircle, FaCheckCircle, FaMagic   } from "react-icons/fa";
import "./BudgetIntelligence.css";
import { BudgetContext } from "../contexts/BudgetContext";
import { useContext } from "react";

export default function BudgetIntelligence() {

  const [insight, setInsight] = useState(null);
  const { totalBudget } = useContext(BudgetContext);

  const fetchBudgetInsight = async () => {
    try {
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const res = await fetch(`${BASE_URL}/auth/budget-insights`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (data.success) {
        setInsight(data.data);
      }

    } catch (error) {
      console.error("Error fetching insights:", error);
    }
  };

  useEffect(() => {
    fetchBudgetInsight();
  }, [totalBudget]);

  const icons = {
    EXCEEDED: <FaExclamationTriangle color="#e11d48" size={18} />,
    HIGH_RISK: <FaExclamationCircle color="#f97316" size={18} />,
    WARNING: <FaExclamationCircle color="#eab308" size={18} />,
    SAFE: <FaCheckCircle color="#10b981" size={18} />
  };

  if (!insight) return null;

  return (
    <div className="budget-intelligence-card">

      <div className="budget-intelligence-heading">
        <div className="heading-icon">
          <FaLightbulb size={18} color="#FFFFFF" />
        </div>
        <h1 className="budget-intelligence-h-text">Budget Intelligence</h1>
      </div>

      <div className={`budget-intelligence-report-card ${insight.type}`}>

        <div className="budget-intelligence-report-heading">
          <div className="heading-icon"  style={{background: "#F3F4F6"}}>
            {icons[insight.type]}
          </div>
          <h1 className="budget-intelligence-h-text">
            {insight.title}
          </h1>

          <p className={`budget-intelligence-report-priority ${insight.type}`}>
            {insight.type.replace("_", " ")}
          </p>
        </div>

        <div className="budget-intelligence-report-insight">
          <p className="budget-intelligence-p-text">
            {insight.message}
          </p>

          <div className="budget-intelligence-report-bar-container">

            <div className="budget-progress-header">
              <span className="budget-progress-title">Budget Progress</span>
              <span className="budget-progress-percent">
                {Math.round(insight.usagePercent)}%
              </span>
            </div>

            <div className="budget-intelligence-report-bar"> 
              <div className="progress-track">
                  <div
                    className={`progress-fill ${insight.type}`}
                    style={{ width: `${Math.min(insight.usagePercent, 100)}%` }}
                  />
              </div>  
            </div>

            <div className="budget-bar-labels">
              <span>₹ {insight.totalSpent}</span>
              <span>₹ {insight.budget}</span>
            </div>

          </div>
        </div>

        <div className="budget-intelligence-smart-tip">
          <div className="budget-intelligence-smart-tip-label">
            <FaMagic style={{ color:"#d97706", fontSize:"16px"}}/>
            <h5>Smart Tip</h5>
          </div>

          <p>{insight.tip}</p>
        </div>

      </div>
    </div>
  );
}
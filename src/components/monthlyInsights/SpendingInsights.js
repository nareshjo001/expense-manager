import './SpendingInsights.css';
import { useState, useEffect } from 'react';
import { FaChartPie, FaTrophy, FaTint } from "react-icons/fa";
import { FaArrowTrendUp } from "react-icons/fa6";

export default function SpendingInsights() {

  const [leftPanelData, setLeftPanelData] = useState(null);
  const [rightPanelData, setRightPanelData] = useState(null);
  const [middlePanelData, setMiddlePanelData] = useState(null);

  const fetchBudgetInsight = async () => {
    try {
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const res = await fetch(`${BASE_URL}/auth/spending-insights`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Server Error");
      }

      const data = await res.json();

      if (data.success) {
        setLeftPanelData(data.data.leftData);
        setRightPanelData(data.data.rightData);
        setMiddlePanelData(data.data.middleData);
      }

    } catch (error) {
      console.error("Error fetching insights:", error);

      setLeftPanelData(null);
      setRightPanelData(null);
      setMiddlePanelData(null);
    }
  };

  useEffect(() => {
    fetchBudgetInsight();
  }, []);

  return (
    <div className="spending-insights-container">
      <div className='spending-insights-container-heading'>
        <div className="heading-icon">
          <FaChartPie size={18} color="#FFFFFF" />
        </div>
        
        <h1 className='spending-insights-h-text' style={{fontWeight: "600"}}>Spending Insights</h1>
      </div>

      <div className="spending-insights-grid">
        {/* LEFT CARD */}
        <div className='spending-insights-left'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon">
              <FaTrophy size={18} color="#FFFFFF" />
            </div>

            <div className='spending-insights-left-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>Top Category</h1>
              <p className='spending-insights-p-text' style={{color: "var(--muted-text)"}}>Your highest spending</p>
            </div>
          </div>

          {leftPanelData 
            ? (
              <>
                <div className="spending-insights-left-body">
                  <p className='spending-insights-p-text'  style={{color: "#374151", fontWeight: "500", marginBottom: "12px"}}>
                      {leftPanelData?.topCategory && leftPanelData?.amount != null ? (
                        <>
                          {leftPanelData.topCategory} is your top category at{" "}
                          <strong style={{ color: "var(--menu-color)" }}>
                            ₹{leftPanelData.amount}
                          </strong>
                        </>
                      ) : (
                        "No category data available yet"
                      )}
                  </p>
                  <p className='spending-insights-p-text'>
                    {leftPanelData?.topCategory
                      ? leftPanelData?.showTopCategoryInsight
                        ? "Exploring small adjustments here could influence overall spending."
                        : `(${Math.round(leftPanelData.percentage)}% of your spending)`
                      : "No spending data available"}
                  </p>
                </div>

                {leftPanelData?.topCategory &&
                  <div className="spending-insights-left-progress">
                    <div className='spending-insights-left-bar'>
                        <div className="progress-track" style={{height: "13px"}}>
                          <div
                              className="spending-progress-fill"
                              style={{ width: `${Math.round(leftPanelData.percentage)}%` }}
                          />
                        </div>

                        <p className='spending-insights-p-text' style={{color: "#000"}}>
                          <strong>{`${Math.round(leftPanelData.percentage)}%`}</strong>
                        </p>
                    </div>
                  </div>
                }
              </>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>No spending insights yet</p>
                <p className='insights-empty-text'>Start tracking expenses to discover your top category</p>
              </div>
            )}
        </div>
        {/* MIDDLE CARD */}
        <div className='spending-insights-middle'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon" style={{background: ""}}>
              <FaTint  size={18} color="#FFFFFF" />
            </div>

            <div className='spending-insights-middle-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>Leaky Bucket</h1>
              <p className='spending-insights-p-text'>Micro-spending Pattern</p>
            </div>
          </div>

          {middlePanelData
            ? (
              <>
                <div className="spending-insights-middle-body">
                  <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)", fontWeight: "700", fontSize: "28px" ,textAlign: "center", marginTop: "20px"}}>
                    ₹{middlePanelData.leakTotal}
                  </h1>
                  
                  <p className='spending-insights-p-text' style={{textAlign: "center"}}><strong>{middlePanelData.count}</strong> small purchases (At an avg <strong>₹{middlePanelData.averageLeak}</strong>)</p>

                  <p className='spending-insights-p-text' style={{marginTop: "20px", fontWeight: "500"}}>{middlePanelData.subMessage}</p>
                </div>
              </>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>No micro-spending detected</p>
                <p className='insights-empty-text'>Great job keeping small expenses under control</p>
              </div>
            )} 
        </div>

        {/* RIGHT CARD */}
        <div className='spending-insights-right'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon">
              <FaArrowTrendUp size={18} color="#FFFFFF" />
            </div>

            <div className='spending-insights-right-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>
                {rightPanelData ? rightPanelData.insight.title : `How You Spend`}
              </h1>
              <p className='spending-insights-p-text'>Behavioral Pattern</p>
            </div>
          </div>

          {rightPanelData 
            ? (
              <>
                <p className='spending-insights-p-text' style={{color: "#374151", fontWeight: "500"}}>
                  {rightPanelData.insight.message}
                </p>

                <div className='spending-insights-right-stats'>
                  <div className='spending-insights-right-stats-weekday'>
                    <p className='spending-insights-p-text'>Weekday Avg</p>
                    <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)"}}>
                      ₹{rightPanelData.weekdayAvg}
                    </h1>
                  </div>

                  <div className='spending-insights-right-stats-weekend'>
                    <p className='spending-insights-p-text'>Weekend Avg</p>
                    <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)"}}>
                      ₹{rightPanelData.weekendAvg}
                    </h1>
                  </div>
                </div>
              </>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>Not enough data to analyze patterns</p>
                <p className='insights-empty-text'>Keep tracking to unlock insights</p>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
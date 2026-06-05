import { useState, useEffect } from 'react';
import '../OverallInsight.css';
import { FaFire, FaChartPie } from "react-icons/fa";
import { FaPiggyBank } from "react-icons/fa6";
import { useInView } from 'react-intersection-observer';

export default function OverallInsight({ period }) {

  const [insight, setInsight] = useState(null);

  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.5
  });
  
  useEffect(() => {
    const fetchOverallInsight = async () => {
      try {
          const token = localStorage.getItem("token");
          const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
    
          const res = await fetch(`${BASE_URL}/auth/income-insights-card`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}` },
            body: JSON.stringify({ period }),
          });
    
          if (!res.ok) {
            throw new Error("Server error");
          }

          const data = await res.json();
    
          if (data.success) {
            setInsight(data.data ?? null);
          } else {
            setInsight(null);
          }
    
      } catch (error) {
          console.error("Error fetching insights:", error);
          setInsight(null);
        }
    };

    fetchOverallInsight();
  }, [period]);

  return (
    <div className='overall-insights-container'>
      
      <div className='overall-insights-card spending-jump'>
        <div className='overall-insights-card-head spending-jump-head'>
          <div className="heading-icon">
            <FaPiggyBank size={18} color="#FFFFFF" />
          </div>

          <h1 className='overall-insights-h-text'>
            Savings Rate
          </h1>
        </div>

        {insight?.savingsRateData ? (
          <div className='overall-insights-card-body spending-jump-body'>
            <p className='overall-insights-p-text jump-message' style={{ fontWeight: "600" }}>
              {insight?.savingsRateData?.status}
            </p>

            <div className='spending-jump-body-time-card'>
              <h1 className='overall-insights-h-text'>
                {insight?.savingsRateData?.savingsRate}%
              </h1>

              <p className='overall-insights-p-text p-wrapper'>
                Saved
                <span
                  style={{
                    fontWeight: "bold",
                    fontSize: "16px"
                  }}
                >
                  ₹{insight?.savingsRateData?.netBalance.toLocaleString()}
                </span>
              </p>
            </div>

            <p
              className='overall-insights-p-text'
              style={{ marginTop: "10px" }}
            >
              {insight?.savingsRateData?.subMessage}
            </p>
          </div>

        ) : (
          <div className='overall-insights-empty-card'>
            <p className='insights-empty-text'>
              No income data available
            </p>

            <p className='insights-empty-text'>
              Add income records to calculate savings rate
            </p>
          </div>
        )}
      </div>

      <div className='overall-insights-card budget-streak'>
        <div className='overall-insights-card-head budget-streak-head'>
          <div className="heading-icon">
              <FaFire size={18} color="#FFFFFF" />
          </div>

          <div className='budget-streak-head-texts'>
            <h1 className='overall-insights-h-text'>Runway Forecast</h1>
            <p className='overall-insights-p-text'>Spending projection</p>
          </div>
        </div>

        {insight?.runwayData ? (
          <div className='overall-insights-card-body budget-streak-body'>

            <h1
              ref={ref}
              className={`overall-insights-h-text streak-number 
                ${!inView ? 'hidden' : ''} 
                ${inView ? 'animate' : ''}`}
            >
              {insight.runwayData.runwayDays}
            </h1>

            <p className='overall-insights-p-text'>
              {insight.runwayData.runwayDays === 1
                ? 'day remaining'
                : 'days remaining'}
            </p>

            <p
              className='overall-insights-p-text'
              style={{ marginTop: '10px' }}
            >
              {insight.runwayData.subMessage}
            </p>
          </div>
        ) : (
          <div className='overall-insights-empty-card'>
            <p className='insights-empty-text'>
              No runway data available
            </p>

            <p className='insights-empty-text'>
              Add income and expenses to calculate your financial runway
            </p>
          </div>
        )}
      </div>

      <div className='overall-insights-card stability-score'>
        <div className='overall-insights-card-head stability-score-head'>
          <div className="heading-icon">
            <FaChartPie size={18} color="#FFFFFF" />
          </div>

          <h1 className='overall-insights-h-text'>
            Income Dependency
          </h1>
        </div>

        {insight?.incomeDependencyData ? (
          <div className='overall-insights-card-body stability-score-body'>
            <div className='stability-score-percentage'>
              <div
                className="circle"
                style={{
                  background: `conic-gradient(
                    #14b8a6 0%,
                    #3b82f6 ${insight.incomeDependencyData.dependencyPercent}%,
                    #e5e7eb ${insight.incomeDependencyData.dependencyPercent}% 100%
                  )`
                }}
              >
                <span>
                  {insight.incomeDependencyData.dependencyPercent}%
                </span>
              </div>
            </div>

            <h3
              className='overall-insights-h-text'
              style={{
                color: "#374151",
                fontSize: "16px",
                fontWeight: "500"
              }}
            >
              {insight.incomeDependencyData.riskLevel}
            </h3>

            <p className='overall-insights-p-text'>
              {insight.incomeDependencyData.subMessage}
            </p>
          </div>
        ) : (
          <div className='overall-insights-empty-card'>
            <p className='insights-empty-text'>
              No income data available
            </p>

            <p className='insights-empty-text'>
              Add income records to analyze dependency
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
import React, { createContext, useState, useEffect } from 'react';

export const BudgetContext = createContext();

export const BudgetProvider = ({ children }) => {
  const [monthlyBudgets, setMonthlyBudgets] = useState([]);
  const [budgetStatus, setBudgetStatus] = useState("loading");

  const fetchBudgets = async () => {
    try {
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const response = await fetch(`${BASE_URL}/auth/getbudgets`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Server error");
      }

      const data = await response.json();

      if (response.ok && data.success) {
        setMonthlyBudgets(data.data);
        setBudgetStatus("ready");
      } else {
        setBudgetStatus("error");
      }

    } catch (err) {
      console.error("Network error:", err);
      setBudgetStatus("error");
    }
  };

  useEffect(() => {
    fetchBudgets();
  }, []);

  const currentMonth =
    new Date().toLocaleString("default", { month: "short" }) +
    " " +
    new Date().getFullYear();

  const currentBudget = monthlyBudgets.find(
    (b) => b.month === currentMonth
  );

  const totalBudget = currentBudget?.budget || 0;
  const spent = currentBudget?.spent || 0;

  return (
    <BudgetContext.Provider value={{ monthlyBudgets, setMonthlyBudgets, fetchBudgets, budgetStatus, totalBudget, spent }}>
      {children}
    </BudgetContext.Provider>
  );
};

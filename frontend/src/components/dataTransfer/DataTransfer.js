import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaFileImport, FaFileExport } from "react-icons/fa";
import ImportWizard from "../importWizard/ImportWizard";
import DataExport from "../dataExport/DataExport";
import "../expensesHandling/AddExpense.css";

const getTabFromLocation = (pathname, search, initialTab) => {
  if (initialTab) return initialTab;
  if (pathname === "/export") return "export";
  if (pathname === "/import") return "import";
  const searchParams = new URLSearchParams(search);
  const tabParam = searchParams.get("tab");
  if (tabParam === "export") return "export";
  return "import";
};

// Toggles between Import and Export under a unified Data Transfer view.
// Mirrors the exact layout, geometry, curves, and interaction states
// of the Add Expense / Add Income toggle bar.
const DataTransfer = ({ initialTab }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState(() =>
    getTabFromLocation(location.pathname, location.search, initialTab)
  );

  useEffect(() => {
    setActiveTab(getTabFromLocation(location.pathname, location.search, initialTab));
  }, [location.pathname, location.search, initialTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    navigate(`/data-transfer?tab=${tab}`, { replace: true });
  };

  return (
    <div className="add-page data-transfer-page">
      <div className="form-toggle add-form-toggle data-transfer-toggle">
        <div
          className={`form-toggle-slider ${
            activeTab === "export" ? "right" : ""
          }`}
          aria-hidden="true"
        />

        <button
          type="button"
          className={activeTab === "import" ? "active" : ""}
          onClick={() => handleTabChange("import")}
          aria-pressed={activeTab === "import"}
          aria-label="Import"
        >
          <span className="add-form-toggle-icon" aria-hidden="true">
            <FaFileImport />
          </span>
          Import
        </button>

        <button
          type="button"
          className={activeTab === "export" ? "active" : ""}
          onClick={() => handleTabChange("export")}
          aria-pressed={activeTab === "export"}
          aria-label="Export"
        >
          <span className="add-form-toggle-icon" aria-hidden="true">
            <FaFileExport />
          </span>
          Export
        </button>
      </div>

      <div key={activeTab} className="add-expense-wrapper data-transfer-panel">
        {activeTab === "import" ? <ImportWizard /> : <DataExport />}
      </div>
    </div>
  );
};

export default DataTransfer;

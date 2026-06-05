import React, { useState } from "react";
import "./BillUpload.css";
import { FaArrowLeft } from "react-icons/fa";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";

const BillUpload = ({ setIsBillUpload, setBillData }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (file) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };
  
  const formatDateForInput = (dateString) => {

    if (!dateString) return "";

    // Handle DD/MM/YYYY
    if (dateString.includes("/")) {

      const [day, month, year] =
        dateString.split("/");

      return `${year}-${month}-${day}`;
    }

    return "";
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("bill", selectedFile);

      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
      const response = await fetch(`${BASE_URL}/bills/bill-upload`, {
        method: "POST",
        body: formData,
      });
      
      if(response.ok) {
        const result = await response.json();
        result.parsedReceipt.expenseDate = formatDateForInput(result.parsedReceipt.expenseDate);
        setBillData(result.parsedReceipt);
        setIsBillUpload(false);
      }
      
    } catch (error) {
      console.error(error);
      expenseAddErrorToast({ message: "Failed to upload bill. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bill-upload-wrapper">
      <div className="bill-upload-container">

        <div className="bill-upload-header">
          <button
            className="back-btn"
            onClick={() => setIsBillUpload(false)}
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}>
              <FaArrowLeft size={14} /> Back
            </span>
          </button>

          <h2>Upload Bill</h2>
        </div>

        <div className="bill-upload-input-section">
          <label>Select Bill Image</label>

          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
          />
        </div>

        {preview && (
          <div className="preview-container">
            <img
              src={preview}
              alt="Preview"
              className="preview-image"
            />
          </div>
        )}

        <button
          type="button"
          className="bill-upload-btn"
          onClick={handleUpload}
          disabled={loading}
        >
          {loading ? "Uploading..." : "Upload Bill"}
        </button>
      </div>
    </div>
  );
};

export default BillUpload;
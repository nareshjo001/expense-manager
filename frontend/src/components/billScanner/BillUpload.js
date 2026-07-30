import React, { useState, useEffect } from "react";
import "./BillUpload.css";
import { FaArrowLeft } from "react-icons/fa";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { useBillUploadMutation } from "../../hooks/mutations/useBillUploadMutation";

// Bill image upload with OCR-based receipt parsing and preview lifecycle management.
const BillUpload = ({ setIsBillUpload, setBillData }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const billUploadMutation = useBillUploadMutation();

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (file) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  // Revokes the previous preview's Blob URL when it's replaced, and the active one on unmount.
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);
  
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

  const handleUpload = () => {
    if (!selectedFile) return;

    billUploadMutation.mutate(selectedFile, {
      onSuccess: (result) => {
        result.parsedReceipt.expenseDate = formatDateForInput(result.parsedReceipt.expenseDate);
        setBillData(result.parsedReceipt);
        setIsBillUpload(false);
      },
      onError: (error) => {
        // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
        const status = error.response?.status;
        if (status === 401 || status === 429 || status === 409) {
          return;
        }

        console.error(error);
        expenseAddErrorToast({ message: "Failed to upload bill. Please try again." });
      },
    });
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
          disabled={billUploadMutation.isPending}
        >
          {billUploadMutation.isPending ? "Uploading..." : "Upload Bill"}
        </button>
      </div>
    </div>
  );
};

export default BillUpload;
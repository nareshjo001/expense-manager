import React, { useState, useEffect, useRef } from "react";
import "./BillUpload.css";
import { FaArrowLeft } from "react-icons/fa";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { useBillUploadMutation } from "../../hooks/mutations/useBillUploadMutation";

// Bill image upload with OCR-based receipt parsing and preview lifecycle management.
const BillUpload = ({ setIsBillUpload, setBillData }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState("");
  const abortControllerRef = useRef(null);

  const billUploadMutation = useBillUploadMutation();

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setSelectedFile(null);
      setPreview(null);
      setFileError("Choose a JPEG or PNG image that is 5 MB or smaller.");
      return;
    }

    setFileError("");
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  // Revokes the previous preview's Blob URL when it's replaced, and the active one on unmount.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
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

    abortControllerRef.current = new AbortController();
    billUploadMutation.mutate({ file: selectedFile, signal: abortControllerRef.current.signal }, {
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

        if (error.code === "ERR_CANCELED") return;
        expenseAddErrorToast({ message: error.response?.data?.message || "Failed to upload bill. Please try again." });
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
          <label htmlFor="bill-upload-file">Select Bill Image</label>

          <input
            id="bill-upload-file"
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            aria-describedby={fileError ? "bill-upload-error" : undefined}
          />
          {fileError && <p id="bill-upload-error" className="bill-upload-error" role="alert">{fileError}</p>}
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

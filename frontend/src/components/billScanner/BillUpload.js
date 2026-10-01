import React, { useState, useEffect, useRef } from "react";
import "./BillUpload.css";
import { FaArrowLeft } from "react-icons/fa";
import { HiOutlineDocumentPlus, HiOutlineExclamationCircle } from "react-icons/hi2";
import { expenseAddErrorToast, receiptNeedsReviewToast } from "../alertsEffects/toastMessages";
import { useBillUploadMutation } from "../../hooks/mutations/useBillUploadMutation";

// Bill image upload with OCR-based receipt parsing and preview lifecycle management.
const BillUpload = ({ setIsBillUpload, setBillData }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState("");
  // Highlights the dropzone while a file is dragged over it. Visual only: a
  // dropped file lands on the native file input and goes through
  // handleFileChange like a picked one.
  const [isDragging, setIsDragging] = useState(false);
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
        if (result.parsedReceipt.needsReview) {
          receiptNeedsReviewToast();
        }
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

  const dropzoneClassName = [
    "bill-upload-dropzone",
    preview && "has-preview",
    fileError && "has-error",
    isDragging && "is-dragging",
  ].filter(Boolean).join(" ");

  return (
    <div className="bill-upload-wrapper">
      <div className="bill-upload-container">

        <div className="bill-upload-header">
          <button
            className="back-btn"
            onClick={() => setIsBillUpload(false)}
          >
            <FaArrowLeft size={13} aria-hidden="true" /> Back
          </button>

          <h2>Upload Bill</h2>
        </div>

        <div className="bill-upload-input-section">
          <div className="bill-upload-intro">
            <label htmlFor="bill-upload-file">Select a receipt image</label>
            <p className="bill-upload-description">
              Upload a clear photo of your bill or receipt. We'll scan it and autofill the expense details.
            </p>
          </div>

          <div className={dropzoneClassName}>
            {/* The real file input, stretched invisibly over the whole zone: a
                click opens the file picker and a dropped file is received by
                the input itself. */}
            <input
              id="bill-upload-file"
              className="bill-upload-file-input"
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileChange}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              onDrop={() => setIsDragging(false)}
              aria-describedby={fileError ? "bill-upload-rules bill-upload-error" : "bill-upload-rules"}
            />

            {preview ? (
              <div className="preview-container">
                <img
                  src={preview}
                  alt="Preview"
                  className="preview-image"
                />
                <span className="bill-upload-file-name">{selectedFile?.name}</span>
                <span className="bill-upload-choose" aria-hidden="true">Choose a different file</span>
              </div>
            ) : (
              <div className="bill-upload-dropzone-content" aria-hidden="true">
                <span className="bill-upload-dropzone-icon">
                  <HiOutlineDocumentPlus />
                </span>
                <span className="bill-upload-choose">Choose File</span>
                <span className="bill-upload-drag">or drag and drop</span>
              </div>
            )}

            <span id="bill-upload-rules" className="bill-upload-rules">Supports JPG, PNG • Max 5MB</span>
          </div>

          {fileError && (
            <p id="bill-upload-error" className="bill-upload-error" role="alert">
              <HiOutlineExclamationCircle aria-hidden="true" />
              {fileError}
            </p>
          )}
        </div>

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

import React from "react";
import "./Spinner.css";

// Full-screen loading spinner overlay.
const Spinner = () => {
  return (
    <div className="spinner-wrapper" role="status" aria-live="polite">
      <span className="loader" aria-hidden="true"></span>
      <span className="spinner-visually-hidden">Loading…</span>
    </div>
  );
};

export default Spinner;
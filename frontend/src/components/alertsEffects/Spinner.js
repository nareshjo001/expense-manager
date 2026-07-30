import React from "react";
import "./Spinner.css";

// Full-screen loading spinner overlay.
const Spinner = () => {
  return (
    <div className="spinner-wrapper">
      <span className="loader"></span>
    </div>
  );
};

export default Spinner;
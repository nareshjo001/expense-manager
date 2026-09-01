"use strict";

// Remediation Workstream C -- shared ML-service request helper.
const OPERATIONS_TOKEN_HEADER = "X-ML-Operations-Token";

// Builds an absolute ML-service URL for `path` (expected to start with
function buildMlServiceUrl(path) {
  const base = process.env.ML_ROUTE;
  if (typeof base !== "string" || base.trim() === "") {
    throw new Error("ML_ROUTE is not configured.");
  }
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Returns the header object to spread into an axios request config's
function mlOperationsHeaders() {
  const token = process.env.ML_OPERATIONS_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    return {};
  }
  return { [OPERATIONS_TOKEN_HEADER]: token };
}

const axios = require('axios');

/* Request ML spending forecast prediction. */
async function requestSpendingForecast(features, { timeoutMs = 3000 } = {}) {
  const url = buildMlServiceUrl('/predict-spending-forecast');
  try {
    const resp = await axios.post(url, features, {
      timeout: timeoutMs,
      headers: mlOperationsHeaders(),
    });
    return { success: true, data: resp.data };
  } catch (err) {
    const reason = err.code === 'ECONNABORTED' ? 'ML service timeout'
      : err.response?.data?.message || err.message;
    return { success: false, fallback: true, reason };
  }
}

module.exports = { buildMlServiceUrl, mlOperationsHeaders, OPERATIONS_TOKEN_HEADER, requestSpendingForecast };


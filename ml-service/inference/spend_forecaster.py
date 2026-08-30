import os
import json
from pathlib import Path
from typing import Dict, Any
import joblib
import numpy as np

# Resolve model directory relative to this file
MODEL_DIR = Path(__file__).resolve().parents[1] / "training" / "models" / "spend_forecast"

# Load resources at import time (singleton)
try:
    _model_p10 = joblib.load(MODEL_DIR / "forecast_model_p10.pkl")
    _model_p50 = joblib.load(MODEL_DIR / "forecast_model_p50.pkl")
    _model_p90 = joblib.load(MODEL_DIR / "forecast_model_p90.pkl")
    _scaler = joblib.load(MODEL_DIR / "forecast_scaler.pkl")
    with open(MODEL_DIR / "metadata.json", "r", encoding="utf-8") as f:
        _metadata = json.load(f)
except Exception as exc:
    # If any loading fails, keep placeholders and let predict function handle the error.
    _model_p10 = _model_p50 = _model_p90 = _scaler = None
    _metadata = {"modelVersion": "unknown", "trainedAt": None, "features": []}
    load_error = exc
else:
    load_error = None

def _validate_features(features: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and coerce required feature fields.
    Expected keys correspond to the column names used during training.
    Missing or non‑numeric values are converted to 0.0.
    """
    expected = set(_metadata.get("features", []))
    if not expected:
        # Fallback to a hard‑coded list derived from training script.
        expected = {
            "elapsedDay",
            "daysInMonth",
            "progressRatio",
            "spentSoFar",
            "forecastableSpentSoFar",
            "recurringCommittedTotal",
            "recurringSpentSoFar",
            "recurringPending",
            "mtdTransactionCount",
            "dailyTransactionFrequency",
            "dailySpendVelocity",
            "trailing3MonthAverage",
            "trailing6MonthMedian",
            "historicalTheilSenSlope",
            "residualMad",
            "topCategoryShare",
            "categoryEntropy",
        }
        # Add one‑hot category columns.
        from ml_service.training.generate_forecast_dataset import CANONICAL_CATEGORIES  # noqa: E402
        expected.update({f"cat_{c}" for c in CANONICAL_CATEGORIES})
    vector = []
    for name in sorted(expected):
        value = features.get(name, 0)
        try:
            vector.append(float(value))
        except Exception:
            vector.append(0.0)
    return {"vector": np.array([vector]), "feature_names": sorted(expected)}

def predict_spending_snapshot(features: Dict[str, Any]) -> Dict[str, Any]:
    """Run the ensemble forecast and return a structured response.
    The response matches the contract expected by the Node.js client.
    """
    if load_error is not None:
        return {"success": False, "error": f"Model loading failed: {load_error}", "isFallback": True}
    try:
        validated = _validate_features(features)
        X = validated["vector"]
        X_scaled = _scaler.transform(X)
        p10 = _model_p10.predict(X_scaled)[0]
        p50 = _model_p50.predict(X_scaled)[0]
        p90 = _model_p90.predict(X_scaled)[0]
        spent_so_far = float(features.get("spentSoFar", 0))
        recurring_pending = float(features.get("recurringPending", 0))
        predicted_total = spent_so_far + recurring_pending + p50
        confidence = max(0.0, 1.0 - (abs(p90 - p10) / max(predicted_total, 1.0)))
        predicted_total = max(predicted_total, spent_so_far + recurring_pending)
        return {
            "success": True,
            "predictedRemaining": round(p50, 2),
            "predictedTotal": round(predicted_total, 2),
            "range": {"lower": round(p10, 2), "upper": round(p90, 2)},
            "confidenceScore": round(confidence, 3),
            "modelVersion": _metadata.get("modelVersion", "unknown"),
            "isFallback": False,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "isFallback": True}

__all__ = ["predict_spending_snapshot"]
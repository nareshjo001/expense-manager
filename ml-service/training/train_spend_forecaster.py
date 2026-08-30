import os
import json
import joblib
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

def train_forecast_models():
    dataset_path = "d:/Projects/Personal/Expense/expense-manager/ml-service/training/dataset/forecast_training_dataset.csv"
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Training dataset not found at: {dataset_path}")
        
    print("Loading training dataset...")
    df = pd.read_csv(dataset_path)
    print(f"Loaded {df.shape[0]} rows and {df.shape[1]} columns.")
    
    # Separate features and target
    X = df.drop(columns=["remainingSpend"])
    y = df["remainingSpend"]
    
    feature_names = list(X.columns)
    
    # Standard split (80% train, 20% test)
    # Note: Since the dataset contains randomized personas chronological splits are group-friendly, 
    # but a simple train_test_split is standard and robust for these independent snapshots.
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print("Standardizing features...")
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train Point Estimator (P50)
    print("Training Median Spending Model (P50 quantile)...")
    model_p50 = HistGradientBoostingRegressor(loss="quantile", quantile=0.5, max_iter=100, random_state=42)
    model_p50.fit(X_train_scaled, y_train)
    
    # Train Lower Bound Estimator (P10)
    print("Training Lower Bound Model (P10 quantile)...")
    model_p10 = HistGradientBoostingRegressor(loss="quantile", quantile=0.1, max_iter=100, random_state=42)
    model_p10.fit(X_train_scaled, y_train)
    
    # Train Upper Bound Estimator (P90)
    print("Training Upper Bound Model (P90 quantile)...")
    model_p90 = HistGradientBoostingRegressor(loss="quantile", quantile=0.9, max_iter=100, random_state=42)
    model_p90.fit(X_train_scaled, y_train)
    
    print("Evaluating models...")
    preds_p50 = model_p50.predict(X_test_scaled)
    preds_p10 = model_p10.predict(X_test_scaled)
    preds_p90 = model_p90.predict(X_test_scaled)
    
    # Enforce non-negative predictions
    preds_p50 = np.clip(preds_p50, 0, None)
    preds_p10 = np.clip(preds_p10, 0, None)
    preds_p90 = np.clip(preds_p90, 0, None)
    
    # Compute metrics
    mae = mean_absolute_error(y_test, preds_p50)
    
    # WAPE (Weighted Absolute Percentage Error)
    total_actual = np.sum(np.abs(y_test))
    wape = np.sum(np.abs(y_test - preds_p50)) / total_actual if total_actual > 0 else 0.0
    
    # Coverage check: percentage of actual values falling within [P10, P90]
    covered = (y_test >= preds_p10) & (y_test <= preds_p90)
    coverage = np.mean(covered)
    
    print(f"Test MAE: {mae:.2f}")
    print(f"Test WAPE: {wape * 100:.2f}%")
    print(f"P10-P90 Range Coverage: {coverage * 100:.2f}%")
    
    # Save model bundle
    output_dir = "d:/Projects/Personal/Expense/expense-manager/ml-service/training/models/spend_forecast"
    os.makedirs(output_dir, exist_ok=True)
    
    print("Saving models...")
    joblib.dump(model_p50, os.path.join(output_dir, "forecast_model_p50.pkl"))
    joblib.dump(model_p10, os.path.join(output_dir, "forecast_model_p10.pkl"))
    joblib.dump(model_p90, os.path.join(output_dir, "forecast_model_p90.pkl"))
    joblib.dump(scaler, os.path.join(output_dir, "forecast_scaler.pkl"))
    
    # Save metadata
    metadata = {
        "modelVersion": "spend-forecast-gbdt-v1.0.0",
        "trainedAt": datetime.utcnow().isoformat() + "Z",
        "features": feature_names,
        "metrics": {
            "mae": round(float(mae), 2),
            "wape": round(float(wape), 4),
            "coverage": round(float(coverage), 4)
        }
    }
    
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)
        
    print("Model training successfully completed and serialized.")

if __name__ == "__main__":
    train_forecast_models()

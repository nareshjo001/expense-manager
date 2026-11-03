import json
import os
import re

from inference.predictor_manager import predictor_manager

# Model state lives in predictor_manager's snapshot; importing this module never loads anything.

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)
THRESHOLD_POLICY_PATH = os.path.join(BASE_DIR, "training", "threshold_policy.json")

# Json is missing or unreadable, so a prediction request never fails just because that artifact hasn't been (re)generated in a given environment.
FALLBACK_GLOBAL_THRESHOLD = 0.90

# The only abstention reason this policy defines today.
ABSTAIN_REASON_LOW_CONFIDENCE = "low_confidence"


def _load_threshold_policy():
    """Json (ML-003-T02) fresh on every call. g."""
    try:
        with open(THRESHOLD_POLICY_PATH, "r", encoding="utf-8") as fh:
            policy = json.load(fh)
        if "globalDefaultThreshold" not in policy:
            raise ValueError("threshold_policy.json missing 'globalDefaultThreshold'")
        return policy
    except Exception:
        return {
            "globalDefaultThreshold": FALLBACK_GLOBAL_THRESHOLD,
            "perClassThresholds": {},
        }


def resolve_abstention(category, confidence_percent, policy):
    """Decide whether a prediction should be surfaced as an abstention rather than a confident suggestion, per ML-003-T02's policy."""
    per_class = policy.get("perClassThresholds") or {}
    threshold = per_class.get(category)

    if threshold is None:
        threshold = policy.get("globalDefaultThreshold", FALLBACK_GLOBAL_THRESHOLD)

    if (confidence_percent / 100.0) < threshold:
        return True, ABSTAIN_REASON_LOW_CONFIDENCE

    return False, None


def preprocess_text(text):

    cleaned = (
        str(text)
        .lower()
        .strip()
    )

    cleaned = re.sub(
        r"[^a-zA-Z0-9\s]",
        "",
        cleaned
    )

    cleaned = " ".join(cleaned.split())

    return cleaned

def predict_category(expense_name):

    try:

        # One internally-consistent snapshot (model + vectorizer + encoder from the same activated candidate).
        snapshot = predictor_manager.get_snapshot()

        if snapshot is None:
            # Defensive fallback: only reachable if predictor_manager.initialize() never ran or fully failed.
            return {
                "error": "no model is currently loaded"
            }

        cleaned = preprocess_text(expense_name)

        vector = snapshot.vectorizer.transform([cleaned])

        prediction = snapshot.model.predict(vector)

        category = snapshot.labelEncoder.inverse_transform(prediction)[0]

        probabilities = snapshot.model.predict_proba(vector)

        confidence = max(probabilities[0]) * 100

        confidence = round(confidence, 2)

        # Additive to the original response shape (no modelVersion or other internal fields exposed here): `abstained`/ `abstentionReason` are new fields, `predictedCategory`/ `confidence` keep meaning exactly what they always did.
        policy = _load_threshold_policy()
        abstained, abstention_reason = resolve_abstention(category, confidence, policy)

        return {
            "expenseName": expense_name,
            "cleanedText": cleaned,
            "predictedCategory": category,
            "confidence": confidence,
            "abstained": abstained,
            "abstentionReason": abstention_reason,
        }

    except Exception as e:

        return {
            "error": str(e)
        }

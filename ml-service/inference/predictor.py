import json
import os
import re

from inference.predictor_manager import predictor_manager

# Model state lives in predictor_manager's snapshot; importing this module never loads anything.

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)
THRESHOLD_POLICY_PATH = os.path.join(BASE_DIR, "training", "threshold_policy.json")

# ML-003-T02's own chosen value (training/threshold_policy.py's
# GLOBAL_DEFAULT_THRESHOLD) -- used ONLY if threshold_policy.json is
# missing or unreadable, so a prediction request never fails just because
# that artifact hasn't been (re)generated in a given environment. A second,
# separate literal rather than an import of training/threshold_policy.py
# on purpose: inference/ has no import dependency on training/ today, and
# a training-side refactor should never be able to break live inference.
FALLBACK_GLOBAL_THRESHOLD = 0.90

# The only abstention reason this policy defines today. A stable string
# (not just the `abstained` bool) so a second reason can be added later
# without a breaking API change -- T04's UI copy and T05's outcome
# tracking both need to tell WHY a prediction was abstained.
ABSTAIN_REASON_LOW_CONFIDENCE = "low_confidence"


def _load_threshold_policy():
    """
    ML-003-T03 -- reads training/threshold_policy.json (ML-003-T02) fresh
    on every call. Deliberately NOT cached: this file is small (a few KB),
    read once per prediction request alongside far more expensive TF-IDF
    vectorization + model inference on that same request, and re-reading
    it means a freshly regenerated policy (e.g. after re-running
    threshold_policy.py against a new calibration report) takes effect on
    the very next prediction -- no stale in-process cache to invalidate.

    Never raises: any failure to read/parse the file falls back to a
    minimal policy built from FALLBACK_GLOBAL_THRESHOLD, so a missing or
    malformed threshold_policy.json degrades prediction behavior rather
    than breaking it.
    """
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
    """
    ML-003-T03 -- decide whether a prediction should be surfaced as an
    abstention rather than a confident suggestion, per ML-003-T02's
    policy. `confidence_percent` is on the same 0-100 scale
    predict_category already returns (threshold_policy.json stores
    thresholds on a 0-1 scale) -- converted once here so callers never
    have to remember which scale a given number is on.

    A per-class override in policy["perClassThresholds"] wins when present
    and non-null; none are populated yet as of T02 (see that task's
    documented revisitTrigger), so policy["globalDefaultThreshold"]
    currently applies to every category uniformly.

    Returns (abstained: bool, reason: str | None).
    """
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

        # ML-003-T03 -- additive to the original response shape (no
        # modelVersion or other internal fields exposed here): `abstained`/
        # `abstentionReason` are new fields, `predictedCategory`/
        # `confidence` keep meaning exactly what they always did. The
        # prediction is still returned even when abstained -- ML-003's
        # whole premise is showing it as an editable suggestion the user
        # must confirm, not withholding it.
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

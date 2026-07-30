import re

from inference.predictor_manager import predictor_manager

# Model state lives in predictor_manager's snapshot; importing this module never loads anything.


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

        # Deliberately the original response shape -- no modelVersion or other internal fields exposed here.
        return {
            "expenseName": expense_name,
            "cleanedText": cleaned,
            "predictedCategory": category,
            "confidence": confidence,
        }

    except Exception as e:

        return {
            "error": str(e)
        }

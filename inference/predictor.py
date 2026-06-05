# EXPENSE CATEGORY PREDICTOR

# IMPORTS
import os
import re
import sys
import json
import joblib

# PATH SETUP
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

# go one folder back
BASE_DIR = os.path.dirname(CURRENT_DIR)

MODEL_PATH = os.path.join(
    BASE_DIR, 
    "training", 
    "model.pkl"
)

VECTORIZER_PATH = os.path.join(
    BASE_DIR,
    "training",
    "vectorizer.pkl"
)

ENCODER_PATH = os.path.join(
    BASE_DIR,
    "training",
    "labelEncoder.pkl"
)

# LOAD FILES
try:

    model = joblib.load(MODEL_PATH)

    vectorizer = joblib.load(VECTORIZER_PATH)

    encoder = joblib.load(ENCODER_PATH)

except Exception as e:

    print(json.dumps({
        "error": str(e)
    }))

    sys.exit()

# TEXT PREPROCESSING FUNCTION
def preprocess_text(text):

    cleaned = (
        str(text)
        .lower()
        .strip()
    )

    # remove special characters
    cleaned = re.sub(
        r"[^a-zA-Z0-9\s]",
        "",
        cleaned
    )

    # remove extra spaces
    cleaned = " ".join(cleaned.split())

    return cleaned

# CATEGORY PREDICTION FUNCTION
def predict_category(expense_name):

    try:

        # CLEAN INPUT
        cleaned = preprocess_text(expense_name)

        # TF-IDF TRANSFORM
        vector = vectorizer.transform([cleaned])

        # PREDICT CATEGORY
        prediction = model.predict(vector)

        category = encoder.inverse_transform(prediction)[0]

        # CONFIDENCE SCORE
        probabilities = model.predict_proba(vector)

        confidence = max(probabilities[0]) * 100

        confidence = round(confidence, 2)

        # RETURN RESPONSE
        return {
            "expenseName": expense_name,
            "cleanedText": cleaned,
            "predictedCategory": category,
            "confidence": confidence
        }

    except Exception as e:

        return {
            "error": str(e)
        }
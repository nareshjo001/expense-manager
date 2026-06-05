# EXPENSE CATEGORY ML TRAINER

# IMPORTS
import os
import pandas as pd
import joblib

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier

from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# PATH SETUP
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATASET_PATH = os.path.join(
    BASE_DIR,
    "dataset",
    "retrain_data.csv"
)

MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")

VECTORIZER_PATH = os.path.join(BASE_DIR, "vectorizer.pkl")

ENCODER_PATH = os.path.join(BASE_DIR, "labelEncoder.pkl")

# STEP 1 — LOAD DATASET
print("LOADING DATASET...")

try:
    df = pd.read_csv(DATASET_PATH)

    print("DATASET LOADED SUCCESSFULLY\n")

    print("DATASET SHAPE:", df.shape)

except Exception as e:
    print("ERROR LOADING DATASET:", e)
    exit()

# STEP 2 — TEXT CLEANING
print("CLEANING TEXT...")

df["expenseName"] = (
    df["expenseName"]
    .astype(str)
    .str.lower()
    .str.strip()
    .str.replace(r"[^a-zA-Z0-9\s]", "", regex=True)
)

# remove extra spaces
df["expenseName"] = (
    df["expenseName"]
    .str.replace(r"\s+", " ", regex=True)
)

print("TEXT CLEANING COMPLETED")

# STEP 3 — CATEGORY NORMALIZATION
print("NORMALIZING CATEGORIES...")

# lowercase + trim
df["expenseCategory"] = (
    df["expenseCategory"]
    .astype(str)
    .str.lower()
    .str.strip()
)

# CATEGORY MAPPING
CATEGORY_MAPPING = {

    # canonical categories
    "food": "Food",
    "transport": "Transport",
    "shopping": "Shopping",
    "bills": "Bills",
    "entertainment": "Entertainment",
    "groceries": "Groceries",
    "health": "Health",
    "education": "Education",
    "travel": "Travel",
    "rent": "Rent",
    "investment": "Investment",
    "salary": "Salary",
    "personal care": "Personal Care",
    "gifts": "Gifts",
    "others": "Others",

    # aliases / kaggle labels
    "healthcare": "Health",
    "medical": "Health",

    "utilities": "Bills",
    "utility": "Bills",

    "other": "Others",
    "misc": "Others",

    "emi": "Bills",

    "income": "Salary"
}

# apply mapping
df["expenseCategory"] = df["expenseCategory"].map(
    CATEGORY_MAPPING
)

# remove unmapped rows
df = df.dropna(subset=["expenseCategory"])

print("CATEGORY NORMALIZATION COMPLETED\n")

# print("FINAL CATEGORY COUNTS:\n")

# print(df["expenseCategory"].value_counts())

# STEP 4 — FEATURE EXTRACTION
print("TF-IDF VECTORIZATION...")

vectorizer = TfidfVectorizer()

X = vectorizer.fit_transform(df["expenseName"])

print("TF-IDF COMPLETED")

print("FEATURE MATRIX SHAPE:", X.shape)

# STEP 5 — LABEL ENCODING
print("ENCODING LABELS...")

encoder = LabelEncoder()

y = encoder.fit_transform(df["expenseCategory"])

print("LABEL ENCODING COMPLETED")

# print("\nAVAILABLE CATEGORIES:\n")

# for category in encoder.classes_:
#     print("-", category)

# STEP 6 — TRAIN TEST SPLIT
print("TRAIN TEST SPLIT...")

try:

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y
    )

except:

    print("STRATIFY FAILED — USING NORMAL SPLIT\n")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42
    )

print("TRAIN SIZE:", X_train.shape[0])
print("TEST SIZE :", X_test.shape[0])

# STEP 7 — MODEL
print("CREATING RANDOM FOREST MODEL...")

model = RandomForestClassifier(
    n_estimators=100,
    random_state=42,
    n_jobs=-1,
)

print("MODEL CREATED")

import time

start = time.time()

# STEP 8 — TRAIN MODEL
print("TRAINING MODEL...")

try:

    model.fit(X_train, y_train)

    print(
        f"TRAINING FINISHED IN {time.time() - start:.2f} sec"
    )

    print("\nMODEL TRAINING COMPLETED")

except Exception as e:

    print("\nTRAINING ERROR:", e)

    exit()

# STEP 9 — EVALUATE MODEL
print("EVALUATING MODEL...")

try:

    y_pred = model.predict(X_test)

    accuracy = accuracy_score(y_test, y_pred)

    print("MODEL ACCURACY:", round(accuracy * 100, 2), "%")

    # print("\nCLASSIFICATION REPORT:\n")

    # print(
    #     classification_report(
    #         y_test,
    #         y_pred,
    #         target_names=encoder.classes_
    #     )
    # )

except Exception as e:

    print("EVALUATION ERROR:", e)

# STEP 10 — SAVE FILES
print("SAVING MODEL FILES...")

try:

    joblib.dump(model, MODEL_PATH)

    joblib.dump(vectorizer, VECTORIZER_PATH)

    joblib.dump(encoder, ENCODER_PATH)

    print("MODEL FILES SAVED SUCCESSFULLY\n")

    print("MODEL PATH:")
    print(MODEL_PATH)

    print("\nVECTORIZER PATH:")
    print(VECTORIZER_PATH)

    print("\nENCODER PATH:")
    print(ENCODER_PATH)

except Exception as e:

    print("SAVE ERROR:", e)

# COMPLETED
print("TRAINING PIPELINE COMPLETED SUCCESSFULLY")
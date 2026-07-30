# Superseded by training/dataset_builder.py + db/feedback_repository.py; kept for reference, not wired in.

import os
import pandas as pd

from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO_CONN = os.getenv("MONGO_CONN")

client = MongoClient(MONGO_CONN)

db = client['auth-db']

collection = db['mlfeedbacks']

feedback_data = list(
    collection.find({
        "corrected": True
    })
)

collection.update_many(
    {
        "corrected": True
    },
    {
        "$set": {
            "corrected": False
        }
    }
)

print("Feedback flags reset")

rows = []

for item in feedback_data:

    rows.append({

        "expenseName":
            item.get("expenseName", ""),

        "expenseCategory":
            item.get("actualCategory", "")

    })

df = pd.DataFrame(rows)

CURRENT_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

SAVE_PATH = os.path.join(
    CURRENT_DIR,
    "dataset",
    "feedback_data.csv"
)

df.to_csv(SAVE_PATH, index=False)

print(f"Feedback data exported to {SAVE_PATH}")
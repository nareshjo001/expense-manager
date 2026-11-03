"""Canonical expense-category taxonomy and normalization (Phase C)."""

CANONICAL_CATEGORIES = [
    "Food",
    "Transport",
    "Shopping",
    "Bills",
    "Entertainment",
    "Groceries",
    "Health",
    "Education",
    "Travel",
    "Rent",
    "Investment",
    "Salary",
    "Personal Care",
    "Gifts",
    "Others",
]

# Plain dict (not wrapped) so trainer.py can use it directly with pandas' vectorized `.map(...)`.
CATEGORY_ALIASES = {
    # canonical categories (identity mappings)
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

    "income": "Salary",
}


def normalize_category(raw_value):
    """Normalize a raw category string to one of CANONICAL_CATEGORIES."""
    if not isinstance(raw_value, str):
        return None
    cleaned = raw_value.strip().lower()
    if not cleaned:
        return None
    return CATEGORY_ALIASES.get(cleaned)


def normalize_expense_name(raw_value):
    """Lightweight normalization used for feedback validation and dedup/conflict grouping keys ("is this non-empty", "do these two rows refer to the same merchant string")."""
    if not isinstance(raw_value, str):
        return ""
    return " ".join(raw_value.strip().split())

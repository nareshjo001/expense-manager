"""
Canonical expense-category taxonomy and normalization (Phase C).

Single source of truth for the category mapping that was previously
duplicated as a local `CATEGORY_MAPPING` dict inside training/trainer.py.
Both training/dataset_builder.py (row validation during dataset assembly)
and training/trainer.py (its own full-dataset normalization pass) import
from here now, so the training-time taxonomy cannot silently drift between
"is this feedback row valid" and "how does the trainer normalize the final
CSV" just because someone edited one copy and not the other.

Known remaining duplication, deliberately NOT touched in Phase C:
inference/descriptionGenerator.py's CATEGORY_TEMPLATES dict independently
enumerates the same 15 canonical category names for its own, unrelated
purpose (description templates, not training data). Phase C's brief is
dataset assembly, not a broad refactor of the description-generation
feature, so unifying that is left as a deferred cleanup for a later phase.
"""

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
    """
    Normalize a raw category string to one of CANONICAL_CATEGORIES.

    Trims whitespace and compares case-insensitively before looking up
    CATEGORY_ALIASES. Returns the canonical category string, or None if
    `raw_value` is not a usable string or does not map to any known
    category -- callers must treat None as "invalid", not silently coerce
    it.
    """
    if not isinstance(raw_value, str):
        return None
    cleaned = raw_value.strip().lower()
    if not cleaned:
        return None
    return CATEGORY_ALIASES.get(cleaned)


def normalize_expense_name(raw_value):
    """
    Lightweight normalization used for feedback validation and dedup/conflict
    grouping keys ("is this non-empty", "do these two rows refer to the same
    merchant string"). This is deliberately NOT the same as trainer.py's own
    text-cleaning step (lowercasing + stripping non-alphanumeric characters),
    which still runs separately over the FULL combined dataset (base rows
    included) inside trainer.py and is unchanged in Phase C. This function
    only trims and collapses whitespace, preserving case and punctuation, so
    it stays a light validation/grouping helper rather than a second,
    competing text-cleaning implementation.
    """
    if not isinstance(raw_value, str):
        return ""
    return " ".join(raw_value.strip().split())

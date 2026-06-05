# descriptionGenerator.py

import random
import re

# CATEGORY TEMPLATES
CATEGORY_TEMPLATES = {

    "Food": [

        "Meal expense",
        "Food order",
        "Snack expense",
        "Dining expense",
        "Food delivery",
        "Restaurant payment",
        "Beverage purchase"

    ],

    "Transport": [

        "Travel expense",
        "Cab ride",
        "Fuel expense",
        "Transport payment",
        "Local commute",
        "Travel fare"

    ],

    "Shopping": [

        "Purchase expense",
        "Online shopping",
        "Retail purchase",
        "Product purchase",
        "Shopping payment"

    ],

    "Bills": [

        "Monthly payment",
        "Recharge payment",
        "Utility bill",
        "Subscription payment",
        "Bill payment"

    ],

    "Entertainment": [

        "Entertainment expense",
        "Subscription payment",
        "Movie expense",
        "Gaming purchase",
        "Media subscription"

    ],

    "Groceries": [

        "Grocery shopping",
        "Daily essentials",
        "Household purchase",
        "Groceries expense"

    ],

    "Health": [

        "Medical expense",
        "Healthcare payment",
        "Medicine purchase",
        "Health-related expense"

    ],

    "Education": [

        "Educational expense",
        "Course payment",
        "Learning expense",
        "Study-related payment"

    ],

    "Travel": [

        "Trip expense",
        "Travel booking",
        "Journey expense",
        "Vacation expense"

    ],

    "Rent": [

        "Monthly rent",
        "Accommodation payment",
        "Rental expense"

    ],

    "Investment": [

        "Investment payment",
        "Funds invested",
        "Investment contribution"

    ],

    "Salary": [

        "Salary credited",
        "Income received",
        "Monthly salary"

    ],

    "Personal Care": [

        "Personal care expense",
        "Self-care purchase",
        "Grooming expense"

    ],

    "Gifts": [

        "Gift purchase",
        "Gift expense",
        "Present purchase"

    ],

    "Others": [

        "General expense",
        "Miscellaneous payment",
        "Expense recorded"

    ]
}
# KEYWORD BASED SMART DESCRIPTIONS
KEYWORD_RULES = {
    # FOOD
    "biryani": "Meal expense",
    "pizza": "Fast food purchase",
    "burger": "Fast food purchase",
    "juice": "Beverage purchase",
    "coffee": "Coffee expense",
    "tea": "Tea/snack expense",
    "omelette": "Snack expense",

    # BILLS
    "recharge": "Mobile recharge",
    "wifi": "Internet payment",
    "broadband": "Internet payment",
    "electricity": "Electricity bill",
    "eb": "Electricity bill",
    "netflix": "Subscription payment",
    "spotify": "Music subscription",

    # TRANSPORT
    "uber": "Cab ride",
    "ola": "Cab ride",
    "rapido": "Bike ride",
    "petrol": "Fuel expense",
    "diesel": "Fuel expense",

    # SHOPPING
    "amazon": "Online shopping",
    "flipkart": "Online shopping",
    "myntra": "Fashion purchase",

    # HEALTH
    "medicine": "Medicine purchase",
    "hospital": "Medical expense",
    "doctor": "Doctor consultation",

    # EDUCATION
    "udemy": "Course purchase",
    "coursera": "Course subscription",

    # TRAVEL
    "flight": "Flight booking",
    "hotel": "Hotel booking",

    # PERSONAL CARE
    "salon": "Salon expense",
    "haircut": "Hair grooming expense"

}

# CLEAN TEXT
def clean_text(text=""):

    text = str(text).lower().strip()

    text = re.sub(
        r"[^a-zA-Z0-9\s]",
        "",
        text
    )

    text = " ".join(text.split())

    return text

# EXTRACT MERCHANT / KEYWORD
def extract_first_word(expense_name=""):

    cleaned = clean_text(expense_name)

    words = cleaned.split()

    if len(words) == 0:
        return ""

    return words[0]

# KEYWORD RULE CHECK
def generate_keyword_description(expense_name=""):

    cleaned = clean_text(expense_name)

    for keyword in KEYWORD_RULES:

        if keyword in cleaned:

            return KEYWORD_RULES[keyword]

    return None

# MAIN DESCRIPTION GENERATOR
def generate_description(

    expense_name="",
    category="Others",
    amount=0

):

    # STEP 1 — KEYWORD RULES
    keyword_description = generate_keyword_description(
        expense_name
    )

    if keyword_description:

        return keyword_description

    # STEP 2 — CATEGORY TEMPLATES
    templates = CATEGORY_TEMPLATES.get(
        category,
        CATEGORY_TEMPLATES["Others"]
    )

    # random template
    description = random.choice(templates)

    # STEP 3 — AMOUNT-BASED ENRICHMENT
    try:

        amount = float(amount)

        if amount > 5000:

            description = (
                "High-value " +
                description.lower()
            )

    except:
        pass

    return description

def generate_description_response(
    expense_name,
    category,
    amount
):
    description = generate_description(
        expense_name=expense_name,
        category=category,
        amount=amount
    )

    return {
        "description": description
    }
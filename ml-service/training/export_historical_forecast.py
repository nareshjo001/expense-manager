import os
import csv
import sys
import math
from datetime import datetime
from collections import defaultdict
from bson import ObjectId

# Set up paths so we can import from db.mongo and training.category_config
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from db.mongo import get_db
from training.category_config import normalize_category

CANONICAL_CATEGORIES = [
    "Food", "Transport", "Shopping", "Bills", "Entertainment",
    "Groceries", "Health", "Education", "Travel", "Rent",
    "Investment", "Salary", "Personal Care", "Gifts", "Others"
]

def median(lst):
    if not lst:
        return 0.0
    s = sorted(lst)
    mid = len(s) // 2
    if len(s) % 2 != 0:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0

def fit_robust_trend(points):
    n = len(points)
    if n == 0:
        return 0.0, 0.0, 0.0
    if n == 1:
        return 0.0, float(points[0]), 0.0
    
    slopes = []
    for i in range(n):
        for j in range(i + 1, n):
            slopes.append((points[j] - points[i]) / (j - i))
    
    slope = median(slopes)
    intercepts = [points[i] - slope * i for i in range(n)]
    intercept = median(intercepts)
    
    residuals = [points[i] - (intercept + slope * i) for i in range(n)]
    res_median = median(residuals)
    deviations = [abs(r - res_median) for r in residuals]
    residual_mad = median(deviations)
    
    return slope, intercept, residual_mad

def parse_date(date_val):
    if isinstance(date_val, datetime):
        return date_val
    try:
        return datetime.fromisoformat(str(date_val).replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.strptime(str(date_val)[:10], "%Y-%m-%d")
        except Exception:
            return None

def extract_real_historical_data():
    db = get_db()
    
    # 1. Fetch all expenses
    raw_expenses = list(db.expenses.find({}))
    if not raw_expenses:
        print("No real expenses found in database.")
        return []
    
    print(f"Found {len(raw_expenses)} raw expenses in database.")
    
    # 2. Group expenses by user and month
    # user_data[user_id][month_key] = [expense, ...]
    user_data = defaultdict(lambda: defaultdict(list))
    
    for exp in raw_expenses:
        user_id = str(exp.get("userId"))
        date_obj = parse_date(exp.get("expenseDate"))
        amount = float(exp.get("expenseAmount", 0))
        
        if not user_id or not date_obj or amount <= 0:
            continue
            
        month_key = f"{date_obj.year}-{date_obj.month:02d}"
        
        # Resolve category
        category = normalize_category(exp.get("expenseCategory")) or "Others"
        is_recurring = exp.get("isRecurring") == True
        
        expenses_entry = {
            "day": date_obj.day,
            "amount": amount,
            "category": category,
            "isRecurring": is_recurring,
            "date": date_obj
        }
        user_data[user_id][month_key].append(expenses_entry)
        
    data_rows = []
    
    # Get current month key to exclude the current in-progress month from target completed calculations
    now = datetime.utcnow()
    current_month_key = f"{now.year}-{now.month:02d}"
    
    # 3. For each user, process their months chronologically
    for user_id, months in user_data.items():
        sorted_month_keys = sorted(months.keys())
        completed_month_keys = [mk for mk in sorted_month_keys if mk != current_month_key]
        
        historical_totals = []
        
        for m_idx, month_key in enumerate(sorted_month_keys):
            # We can only extract target prediction pairs for completed months (so we know the final target)
            is_completed = (month_key in completed_month_keys)
            month_expenses = months[month_key]
            total_month_spend = sum(e["amount"] for e in month_expenses)
            
            # If not completed, we add it to the historical list for the future, but don't output rows yet
            if not is_completed:
                historical_totals.append(total_month_spend)
                continue
                
            # Sample cut-offs
            cut_offs = [1, 3, 5, 8, 12, 15, 18, 22, 25, 28]
            days_in_month = 30 # default
            
            # Calculate standard discretionary average/median for anomaly threshold
            discretionary_amounts = [e["amount"] for e in month_expenses if not e["isRecurring"]]
            discretionary_mean = sum(discretionary_amounts) / len(discretionary_amounts) if discretionary_amounts else 400.0
            
            # Extract snapshots at each cut-off
            for d in cut_offs:
                progress_ratio = d / days_in_month
                
                # MTD Transactions
                mtd_expenses = [e for e in month_expenses if e["day"] <= d]
                spent_so_far = sum(e["amount"] for e in mtd_expenses)
                
                # Adjust for outliers in forecastableSpentSoFar
                adjusted_mtd = []
                for e in mtd_expenses:
                    if not e["isRecurring"] and e["amount"] > discretionary_mean * 3.5:
                        adjusted_mtd.append(discretionary_mean)
                    else:
                        adjusted_mtd.append(e["amount"])
                forecastable_spent = sum(adjusted_mtd)
                
                # Recurring totals
                recurring_bills = [e for e in month_expenses if e["isRecurring"]]
                recurring_committed = sum(e["amount"] for e in recurring_bills)
                recurring_spent = sum(e["amount"] for e in recurring_bills if e["day"] <= d)
                recurring_pending = sum(e["amount"] for e in recurring_bills if e["day"] > d)
                
                mtd_count = len(mtd_expenses)
                daily_freq = mtd_count / d
                daily_velocity = spent_so_far / d
                
                # Roll history values (using historical_totals list)
                trailing_3_avg = sum(historical_totals[-3:]) / len(historical_totals[-3:]) if historical_totals else total_month_spend
                trailing_6_med = median(historical_totals[-6:]) if historical_totals else total_month_spend
                slope, intercept, residual_mad = fit_robust_trend(historical_totals[-12:])
                
                # Category shares
                category_spent = {cat: 0.0 for cat in CANONICAL_CATEGORIES}
                for e in mtd_expenses:
                    category_spent[e["category"]] += e["amount"]
                
                top_cat_amt = max(category_spent.values())
                top_cat_share = top_cat_amt / spent_so_far if spent_so_far > 0 else 0.0
                
                # Compute category entropy
                entropy = 0.0
                if spent_so_far > 0:
                    for cat in CANONICAL_CATEGORIES:
                        share = category_spent[cat] / spent_so_far
                        if share > 0:
                            entropy -= share * math.log(share)
                
                # Form row payload
                row = {
                    "elapsedDay": d,
                    "daysInMonth": days_in_month,
                    "progressRatio": round(progress_ratio, 4),
                    "spentSoFar": round(spent_so_far, 2),
                    "forecastableSpentSoFar": round(forecastable_spent, 2),
                    "recurringCommittedTotal": round(recurring_committed, 2),
                    "recurringSpentSoFar": round(recurring_spent, 2),
                    "recurringPending": round(recurring_pending, 2),
                    "mtdTransactionCount": mtd_count,
                    "dailyTransactionFrequency": round(daily_freq, 4),
                    "dailySpendVelocity": round(daily_velocity, 2),
                    "trailing3MonthAverage": round(trailing_3_avg, 2),
                    "trailing6MonthMedian": round(trailing_6_med, 2),
                    "historicalTheilSenSlope": round(slope, 4),
                    "residualMad": round(residual_mad, 2),
                    "topCategoryShare": round(top_cat_share, 4),
                    "categoryEntropy": round(entropy, 4)
                }
                
                # Add category breakdown features
                for cat in CANONICAL_CATEGORIES:
                    share = category_spent[cat] / spent_so_far if spent_so_far > 0 else 0.0
                    row[f"cat_{cat}"] = round(share, 4)
                    
                # Target: remaining spend from d+1 to end of month
                remaining_spend = total_month_spend - spent_so_far
                row["remainingSpend"] = round(remaining_spend, 2)
                
                data_rows.append(row)
                
            historical_totals.append(total_month_spend)
            
    return data_rows

def main():
    print("Exporting database completed months history for spending forecast dataset...")
    real_data = extract_real_historical_data()
    
    if not real_data:
        print("No completed months data extracted from database. Exiting.")
        return
        
    output_dir = "d:/Projects/Personal/Expense/expense-manager/ml-service/training/dataset"
    output_file = os.path.join(output_dir, "forecast_training_dataset.csv")
    
    # We append to the existing CSV if it exists
    file_exists = os.path.exists(output_file)
    
    # Columns definition matching generate_forecast_dataset.py
    fieldnames = [
        "elapsedDay", "daysInMonth", "progressRatio", "spentSoFar", "forecastableSpentSoFar",
        "recurringCommittedTotal", "recurringSpentSoFar", "recurringPending", "mtdTransactionCount",
        "dailyTransactionFrequency", "dailySpendVelocity", "trailing3MonthAverage", "trailing6MonthMedian",
        "historicalTheilSenSlope", "residualMad", "topCategoryShare", "categoryEntropy"
    ]
    for cat in CANONICAL_CATEGORIES:
        fieldnames.append(f"cat_{cat}")
    fieldnames.append("remainingSpend")
    
    mode = "a" if file_exists else "w"
    with open(output_file, mode=mode, newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(real_data)
        
    print(f"Appended {len(real_data)} real database training rows to: {output_file}")

if __name__ == "__main__":
    main()

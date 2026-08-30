import os
import csv
import random
import math
from datetime import datetime, timedelta

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
    # points are monthly totals in chronological order
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

def generate_spending_history():
    # We will generate 800 personas, each having 12 months of simulated data.
    # Personas:
    # 0: Typical worker (salary, bills, normal groceries, occasional dinner/shopping)
    # 1: Frugal saver (low discretionary spend, strict patterns)
    # 2: High spender (huge leisure spikes, high category entropy)
    # 3: Impulsive/Unstable spender (large irregular one-offs, high variance)
    
    data_rows = []
    total_personas = 800
    months_per_persona = 12
    
    for p_id in range(total_personas):
        p_type = p_id % 4
        
        # Define baseline characteristics for this persona
        if p_type == 0:  # Typical worker
            base_monthly_salary = random.uniform(40000, 60000)
            rent_amount = random.uniform(10000, 15000)
            bills_amount = random.uniform(3000, 6000)
            grocery_frequency = 4  # 4 times a month
            grocery_base = random.uniform(1500, 3000)
            discretionary_freq = 0.4  # daily probability
            discretionary_mean = 400
        elif p_type == 1:  # Frugal saver
            base_monthly_salary = random.uniform(30000, 45000)
            rent_amount = random.uniform(6000, 10000)
            bills_amount = random.uniform(1500, 3000)
            grocery_frequency = 2  # bulk grocery
            grocery_base = random.uniform(2000, 3500)
            discretionary_freq = 0.15
            discretionary_mean = 200
        elif p_type == 2:  # High spender
            base_monthly_salary = random.uniform(80000, 150000)
            rent_amount = random.uniform(20000, 35000)
            bills_amount = random.uniform(6000, 12000)
            grocery_frequency = 8
            grocery_base = random.uniform(2000, 4000)
            discretionary_freq = 0.7
            discretionary_mean = 1000
        else:  # Impulsive / Unstable
            base_monthly_salary = random.uniform(40000, 80000)
            rent_amount = random.uniform(10000, 18000)
            bills_amount = random.uniform(3000, 8000)
            grocery_frequency = 3
            grocery_base = random.uniform(1500, 2500)
            discretionary_freq = 0.3
            discretionary_mean = 500
            
        # Simulate completed months history to calculate rolling baseline metrics
        historical_totals = []
        for m in range(24): # generate 24 months of background history to populate baselines
            m_total = rent_amount + bills_amount
            # groc
            for _ in range(grocery_frequency):
                m_total += grocery_base * random.uniform(0.8, 1.2)
            # discretionary
            for day in range(1, 31):
                if random.random() < discretionary_freq:
                    m_total += random.expovariate(1.0 / discretionary_mean)
                # random weekend multiplier
                if day % 7 in [5, 6] and random.random() < 0.5:
                    m_total += random.uniform(500, 1500)
            historical_totals.append(m_total)
            
        # Now simulate the target 12 months for the dataset
        for m_idx in range(months_per_persona):
            days_in_month = 30
            
            # Generate the list of all transactions for this month
            expenses = []
            
            # Rent (day 1, isRecurring=True)
            expenses.append({
                "day": 1,
                "amount": rent_amount,
                "category": "Rent",
                "isRecurring": True
            })
            
            # Bills (day 5, isRecurring=True)
            expenses.append({
                "day": 5,
                "amount": bills_amount * random.uniform(0.9, 1.1),
                "category": "Bills",
                "isRecurring": True
            })
            
            # Groceries (recurring interval)
            for i in range(grocery_frequency):
                day = int(1 + (i * (days_in_month / grocery_frequency)) + random.randint(-1, 1))
                day = max(1, min(days_in_month, day))
                expenses.append({
                    "day": day,
                    "amount": grocery_base * random.uniform(0.85, 1.15),
                    "category": "Groceries",
                    "isRecurring": True
                })
                
            # Discretionary items
            for day in range(1, days_in_month + 1):
                # Check for weekend leisure bump
                is_weekend = (day % 7 in [5, 6])
                p_spend = discretionary_freq * (1.5 if is_weekend else 1.0)
                
                if random.random() < p_spend:
                    category = random.choice(["Food", "Transport", "Shopping", "Entertainment", "Personal Care", "Others"])
                    val = random.expovariate(1.0 / discretionary_mean) * (1.8 if is_weekend else 1.0)
                    expenses.append({
                        "day": day,
                        "amount": round(val, 2),
                        "category": category,
                        "isRecurring": False
                    })
            
            # Random large one-off anomaly (Poisson style) for impulsive/unstable or general users occasionally
            if p_type == 3 or random.random() < 0.15:
                day = random.randint(3, 27)
                category = random.choice(["Shopping", "Health", "Travel", "Gifts"])
                val = discretionary_mean * random.uniform(4.0, 10.0)
                expenses.append({
                    "day": day,
                    "amount": round(val, 2),
                    "category": category,
                    "isRecurring": False
                })

            # Calculate total actual monthly spend
            total_month_spend = sum(e["amount"] for e in expenses)
            
            # Choose sampling points (cut-offs) inside the month
            cut_offs = [1, 3, 5, 8, 12, 15, 18, 22, 25, 28]
            
            # Extract snapshots at each cut-off
            for d in cut_offs:
                progress_ratio = d / days_in_month
                
                # MTD Transactions
                mtd_expenses = [e for e in expenses if e["day"] <= d]
                spent_so_far = sum(e["amount"] for e in mtd_expenses)
                
                # Identify and exclude one-off high-value anomalies for "forecastableSpentSoFar"
                adjusted_mtd = []
                for e in mtd_expenses:
                    # Anomaly threshold: > 3x mean of standard discretionary spend
                    if not e["isRecurring"] and e["amount"] > discretionary_mean * 3.5:
                        # soft-cap to standard baseline
                        adjusted_mtd.append(discretionary_mean)
                    else:
                        adjusted_mtd.append(e["amount"])
                forecastable_spent = sum(adjusted_mtd)
                
                # Recurring totals
                recurring_bills = [e for e in expenses if e["isRecurring"]]
                recurring_committed = sum(e["amount"] for e in recurring_bills)
                recurring_spent = sum(e["amount"] for e in recurring_bills if e["day"] <= d)
                recurring_pending = sum(e["amount"] for e in recurring_bills if e["day"] > d)
                
                mtd_count = len(mtd_expenses)
                daily_freq = mtd_count / d
                daily_velocity = spent_so_far / d
                
                # Roll history values (using historical_totals queue)
                trailing_3_avg = sum(historical_totals[-3:]) / 3.0
                trailing_6_med = median(historical_totals[-6:])
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
                
            # Add this month's completed total to the historical totals queue
            historical_totals.append(total_month_spend)
            
    return data_rows

def main():
    print("Generating synthetic spending forecast dataset...")
    data = generate_spending_history()
    
    # Define columns
    fieldnames = [
        "elapsedDay", "daysInMonth", "progressRatio", "spentSoFar", "forecastableSpentSoFar",
        "recurringCommittedTotal", "recurringSpentSoFar", "recurringPending", "mtdTransactionCount",
        "dailyTransactionFrequency", "dailySpendVelocity", "trailing3MonthAverage", "trailing6MonthMedian",
        "historicalTheilSenSlope", "residualMad", "topCategoryShare", "categoryEntropy"
    ]
    for cat in CANONICAL_CATEGORIES:
        fieldnames.append(f"cat_{cat}")
    fieldnames.append("remainingSpend")
    
    output_dir = "d:/Projects/Personal/Expense/expense-manager/ml-service/training/dataset"
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "forecast_training_dataset.csv")
    
    with open(output_file, mode="w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
        
    print(f"Generated {len(data)} training rows in: {output_file}")

if __name__ == "__main__":
    main()

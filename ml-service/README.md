# 🤖 Expense Manager – ML Service

A dedicated machine learning microservice responsible for automated expense categorization and template based Expense Description Generation.

This service is deployed independently and communicates with the backend through REST APIs.

---

## 🚀 Features

### Automated Expense Categorization

* Predicts expense category from merchant or expense name
* Confidence-based classification
* Fast API-driven predictions

### Machine Learning Pipeline

* TF-IDF text vectorization
* Random Forest classification
* Label encoding for categories
* Model persistence using Joblib

### Feedback Learning Foundation

* Stores user corrections
* Enables future retraining
* Supports personalized categorization improvements

---

## 🛠️ Tech Stack

* Python
* FastAPI
* Scikit-Learn
* Pandas
* NumPy
* Joblib
* Uvicorn

---

## 🧠 Current Model

### Expense Categorization Model

Input:

* Expense Name / Merchant Name

Output:

* Predicted Category
* Confidence Score

Example:

```json
{
  "expenseName": "Swiggy"
}
```

Response:

```json
{
  "category": "Food",
  "confidence": 0.96
}
```

---

## 📊 Model Architecture

### Text Processing

* Lowercasing
* Text Cleaning
* Token Extraction

### Feature Engineering

* TF-IDF Vectorization

### Classification

* Random Forest Classifier

### Output

* Category Prediction
* Confidence Probability

---

## 🔗 API Endpoints

### Predict Category

```http
POST /predict-category
```

Request:

```json
{
  "expenseName": "Recharge"
}
```

Response:

```json
{
  "category": "Bills",
  "confidence": 0.93
}
```

---

## 🔮 Future Enhancements

### Planned AI Features

* Smart Expense Description Generation
* Spending Pattern Recognition
* Personalized Spending Habit Learning
* Expense Forecasting

---

## 👨‍💻 Author
**NARESH V**

Machine Learning | AI & Data Science | Full-Stack Development
from fastapi import FastAPI
from pydantic import BaseModel

from inference.predictor import predict_category
from inference.descriptionGenerator import (
    generate_description_response
)

app = FastAPI()


class PredictionRequest(BaseModel):
    expenseName: str


class DescriptionRequest(BaseModel):
    expenseName: str
    expenseCategory: str
    expenseAmount: float


@app.get("/")
def health():
    return {
        "status": "running"
    }


@app.post("/predict-category")
def predict(data: PredictionRequest):

    return predict_category(
        data.expenseName
    )


@app.post("/generate-description")
def generate_description_api(
    data: DescriptionRequest
):

    return generate_description_response(
        expense_name=data.expenseName,
        category=data.expenseCategory,
        amount=data.expenseAmount
    )

from training.retrain_pipeline import (
    run_retraining
)

@app.post("/retrain-model")
def retrain_model():

    return run_retraining()
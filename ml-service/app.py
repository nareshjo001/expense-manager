from fastapi import FastAPI
from pydantic import BaseModel
from fastapi import Response

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

@app.head("/")
def health_head():
    return Response(status_code=200)

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

from threading import Thread

training_in_progress = False


def background_retrain():
    global training_in_progress

    try:
        run_retraining()

    finally:
        training_in_progress = False


@app.post("/retrain-model")
def retrain_model():

    global training_in_progress

    if training_in_progress:
        return {
            "success": False,
            "message": "Training already running"
        }

    training_in_progress = True

    Thread(
        target=background_retrain,
        daemon=True
    ).start()

    return {
        "success": True,
        "message": "Retraining started"
    }
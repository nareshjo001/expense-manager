# BALENISA ml-service deployment image, pinned to the validated Python minor version.
FROM python:3.11-slim

WORKDIR /app

# No compiler toolchain installed on purpose; add build-essential if a future dependency needs one.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Mount as a volume so bundles/active.json survive a container recreate and can be shared across replicas.
ENV ML_MODEL_ROOT=/data/models
RUN mkdir -p /data/models

VOLUME ["/data/models"]

EXPOSE 8000

# Production Uvicorn command: no --reload; worker count left to the operator.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

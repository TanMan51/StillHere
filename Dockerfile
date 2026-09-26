# Production image for Railway (or any Docker host). Owner: Person A.
# Builds from the repo root. Once frontend/ exists, add a Node stage that runs
# `npm ci && npm run build` and copies dist/ to /app/frontend/dist (served at /).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY contract contract

WORKDIR /app/backend
# One worker only: the check loop runs inside this process.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

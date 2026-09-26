# Production image for Railway (or any Docker host). Owner: Person A.
# Builds from the repo root: stage 1 builds B's dashboard, stage 2 runs FastAPI,
# which serves that build at / so everything lives at one URL.

FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
# The dashboard calls the real API (same origin) instead of its mock data.
ENV VITE_USE_MOCK=false
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY contract contract
COPY --from=frontend /frontend/dist frontend/dist

WORKDIR /app/backend
# One worker only: the check loop runs inside this process.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
RUN useradd --create-home appuser && mkdir -p data && chown -R appuser /app
USER appuser

EXPOSE 8000
# Access logs are off: request URLs can contain guest search terms (PII). Security events cover auditing.
CMD ["sh", "-c", "python -m scripts.bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log"]

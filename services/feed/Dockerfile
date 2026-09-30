FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TZ=Europe/Paris
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY feed ./feed
RUN useradd --system feed
USER feed
CMD ["python", "-m", "feed.main"]

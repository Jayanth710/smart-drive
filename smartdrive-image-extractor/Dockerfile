# FROM python:3.11-slim

# WORKDIR /app

# RUN apt-get update && apt-get install -y \
#     libgl1 \
#     libglib2.0-0 \
#     && rm -rf /var/lib/apt/lists/*

# RUN pip install --no-cache-dir uv

# COPY pyproject.toml uv.lock ./

# RUN uv sync

# COPY . .

# EXPOSE 8080

# CMD ["uv", "run", "main.py"]

# ---------- builder ----------
FROM python:3.11-slim AS builder
WORKDIR /app

# uv (fast installer)
RUN pip install --no-cache-dir uv

# install deps into a fixed venv path
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ---------- runtime ----------
FROM python:3.11-slim
WORKDIR /app

# Minimal runtime libs for OpenCV wheels + EasyOCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

COPY --from=builder /opt/venv /opt/venv
COPY . .

EXPOSE 8080

# If you have Flask app object: app.app:app
CMD ["python", "main.py"]

# # Use an official Python base image
# FROM python:3.11-slim

# # Set working directory
# WORKDIR /app

# # Install system dependencies (for pdfplumber, etc.)
# RUN apt-get update && apt-get install -y \
#     build-essential \
#     poppler-utils \
#     tesseract-ocr \
#     libmagic1 \
#     libreoffice \
#     && rm -rf /var/lib/apt/lists/*

# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# # Copy project files
# COPY . .

# # Expose port (only needed if it’s a web server)
# EXPOSE 8080

# # Define entrypoint
# CMD ["python", "main.py"]

# ==================================================
# Stage 1: Builder (installs Python deps into venv)
# ==================================================
FROM python:3.11-slim AS builder
WORKDIR /app

# Build deps (only for compiling wheels if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libmagic-dev \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir -r requirements.txt


# ==================================================
# Stage 2: Runtime (small)
# ==================================================
FROM python:3.11-slim
WORKDIR /app

ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV NLTK_DATA=/app/nltk_data

# Runtime OS deps:
# - libmagic1: file type detection for unstructured/python-magic
# - poppler-utils: PDF text extraction (pdftotext) used by many PDF flows
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    poppler-utils \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY . .

# If you really need NLTK for your chunking/tokenizing:
RUN python -m nltk.downloader -d /app/nltk_data punkt averaged_perceptron_tagger

EXPOSE 8080

# If this is a Flask app on Cloud Run, use gunicorn (recommended)
# Set APP_MODULE to wherever your Flask app lives:
# Example: app.app:app  OR if you have a factory: app.app:create_app
ENV APP_MODULE=app.app:app
CMD ["python", "main.py"]
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

# STAGE 1: Builder
# FROM python:3.11-slim as builder

# ENV PYTHONUNBUFFERED=1
# WORKDIR /app

# # Install compilers
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     build-essential \
#     git \
#     && rm -rf /var/lib/apt/lists/*

# # Create a virtual environment (VENV)
# # We will install everything here and simply copy this folder later
# RUN python -m venv /opt/venv
# # Enable venv for the following commands
# ENV PATH="/opt/venv/bin:$PATH"

# # 1. Force CPU-only PyTorch
# RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# # 2. Force CPU-only PaddlePaddle (Critical for 'unstructured' table extraction)
# # Without this, it might pull a larger version or GPU bindings
# RUN pip install --no-cache-dir paddlepaddle -f https://paddlepaddle.org.cn/whl/cpu

# # 3. Install Your Requirements
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# # 4. Download NLTK data directly into the venv
# RUN python -m nltk.downloader -d /opt/venv/nltk_data punkt averaged_perceptron_tagger


# # STAGE 2: Final Runtime
# FROM python:3.11-slim

# WORKDIR /app

# # 1. Install Minimal System Dependencies
# # Replaced 'libreoffice' (huge) with specific modules (writer/calc/impress)
# # Added 'libgl1' and 'libgomp1' which are required by OpenCV/LayoutParser
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     libmagic1 \
#     poppler-utils \
#     tesseract-ocr \
#     libreoffice-writer \
#     libreoffice-calc \
#     libreoffice-impress \
#     pandoc \
#     libgl1 \
#     libgomp1 \
#     && rm -rf /var/lib/apt/lists/*

# # 2. Copy the entire Virtual Environment from builder
# COPY --from=builder /opt/venv /opt/venv

# # 3. Enable the environment
# ENV PATH="/opt/venv/bin:$PATH"
# # Tell NLTK where we put the data
# ENV NLTK_DATA="/opt/venv/nltk_data"

# COPY . .

# # Expose port and run
# ENV PORT=8080
# EXPOSE 8080

# CMD ["python", "main.py"]

# FROM python:3.11-slim-bookworm

# WORKDIR /app
# ENV PYTHONUNBUFFERED=1
# ENV PORT=8080

# # System deps (curl needed for uv installer)
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     curl \
#     libgl1 \
#     libglib2.0-0 \
#     libgomp1 \
#     libmagic1 \
#   && rm -rf /var/lib/apt/lists/*

# # Install uv
# ADD https://astral.sh/uv/install.sh /uv-installer.sh
# RUN sh /uv-installer.sh && rm /uv-installer.sh
# ENV PATH="/root/.local/bin:$PATH"

# # Install deps from lockfile (best caching)
# COPY pyproject.toml uv.lock ./
# RUN uv sync --frozen --no-dev

# # Copy app code last
# COPY . .

# EXPOSE 8080

# # ✅ Pick ONE of these:

# # If you have Flask factory: def create_app(): ...
# CMD ["python", "main.py"]

# If you have app = Flask(__name__)
# CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT} app.app:app"]

# If you truly want to run a script (not recommended for Cloud Run HTTP)
# CMD ["python", "main.py"]

# syntax=docker/dockerfile:1
# FROM python:3.11-slim

# ENV PYTHONDONTWRITEBYTECODE=1 \
#     PYTHONUNBUFFERED=1 \
#     PIP_NO_CACHE_DIR=1 \
#     PORT=8080

# WORKDIR /app

# # System deps (common for OCR / image libs). Add more if needed.
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
#     && rm -rf /var/lib/apt/lists/*

# # ---- install shared core ----
# COPY smartdrive_core/ /app/smartdrive_core/
# RUN pip install --upgrade pip \
#     && pip install /app/smartdrive_core

# # ---- install service ----
# ARG SERVICE_DIR=smartdrive-extractor
# COPY ${SERVICE_DIR}/ /app/service/
# WORKDIR /app/service
# RUN pip install -r requirements.txt

# EXPOSE 8080

# # If your entrypoint is main.py with a Flask app, see Option B below.
# CMD ["python", "main.py"]

# syntax=docker/dockerfile:1
# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# System deps (common for docling/easyocr/opencv/pdf rendering)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv + create venv
RUN pip install --no-cache-dir uv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ---- copy shared core (if your service depends on it as a path dep, it must exist before uv sync) ----
COPY smartdrive_core/ /app/smartdrive_core/

# ---- copy only lockfiles first for caching ----
ARG SERVICE_DIR=smartdrive-extractor
COPY ${SERVICE_DIR}/pyproject.toml ${SERVICE_DIR}/uv.lock /app/service/

WORKDIR /app/service

# Install deps from lock (no dev deps)
RUN uv sync --frozen --no-dev

# ---- now copy the service code ----
COPY ${SERVICE_DIR}/ /app/service/

# Optional: if you want the service installed as a package (only needed if you use entrypoints/import package)
# RUN uv pip install -e .

EXPOSE 8080
CMD ["python", "main.py"]
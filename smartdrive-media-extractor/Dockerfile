# FROM python:3.11-slim

# WORKDIR /app

# RUN apt-get update && apt-get install -y \
#     ffmpeg \
#     && rm -rf /var/lib/apt/lists/*

# RUN pip install uv

# COPY pyproject.toml uv.lock ./

# RUN uv sync

# COPY . .

# EXPOSE 8080

# CMD ["uv", "run", "main.py"]

# ---------- builder ----------
# FROM python:3.11-slim AS builder
# WORKDIR /app

# RUN pip install --no-cache-dir uv

# # install into fixed venv path (not /app/.venv)
# ENV UV_PROJECT_ENVIRONMENT=/opt/venv
# COPY pyproject.toml uv.lock ./
# RUN uv sync --frozen --no-dev

# # ---------- runtime ----------
# FROM python:3.11-slim
# WORKDIR /app

# RUN apt-get update && apt-get install -y --no-install-recommends \
#     ffmpeg \
#   && rm -rf /var/lib/apt/lists/*

# ENV PATH="/opt/venv/bin:$PATH"
# ENV PYTHONUNBUFFERED=1
# ENV PORT=8080

# COPY --from=builder /opt/venv /opt/venv
# COPY . .

# EXPOSE 8080
# CMD ["python", "main.py"]

# FROM python:3.11-slim

# ENV PYTHONDONTWRITEBYTECODE=1 \
#     PYTHONUNBUFFERED=1 \
#     PORT=8080

# WORKDIR /app

# # System deps (common for docling/easyocr/opencv/pdf rendering)
# RUN apt-get update && apt-get install -y \
#     ffmpeg \
#     && rm -rf /var/lib/apt/lists/*

# # Install uv + create venv
# RUN pip install --no-cache-dir uv
# RUN python -m venv /opt/venv
# ENV PATH="/opt/venv/bin:$PATH"
# ENV VIRTUAL_ENV="/opt/venv"

# # ---- copy shared core (if your service depends on it as a path dep, it must exist before uv sync) ----
# COPY smartdrive_core/ /app/smartdrive_core/

# # ---- copy only lockfiles first for caching ----
# ARG SERVICE_DIR=smartdrive-media-extractor
# COPY ${SERVICE_DIR}/pyproject.toml ${SERVICE_DIR}/uv.lock /app/service/

# WORKDIR /app/service

# # Install deps from lock (no dev deps)
# RUN uv sync --frozen --no-dev

# # ---- now copy the service code ----
# COPY ${SERVICE_DIR}/ /app/service/

# # Optional: if you want the service installed as a package (only needed if you use entrypoints/import package)
# # RUN uv pip install -e .

# EXPOSE 8080
# CMD ["uv", "run", "main.py"]

# 1. Use the official uv image for the builder stage
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

# 2. Set working directory to /app (This is the "Root")
WORKDIR /app

# 3. Enable bytecode compilation and copy mode for uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# 4. Copy the CORE package first (Crucial for the path in pyproject.toml)
# We place it at /app/smartdrive_core
COPY smartdrive_core/ /app/smartdrive_core/

# 5. Copy the SERVICE files
# We place them at /app/smartdrive-media-extractor
ARG SERVICE_DIR=smartdrive-media-extractor
WORKDIR /app/${SERVICE_DIR}

# 6. Copy only lock/toml first to cache dependencies
COPY ${SERVICE_DIR}/pyproject.toml ${SERVICE_DIR}/uv.lock ./

# 7. Install dependencies (This uses the relative path ../smartdrive_core)
RUN uv sync --frozen --no-dev --no-install-project

# 8. Now copy the actual source code
COPY ${SERVICE_DIR}/ .

# 9. Sync again to install the project itself
RUN uv sync --frozen --no-dev

# --- Final Runtime Stage ---
FROM python:3.11-slim-bookworm

WORKDIR /app
COPY --from=builder /app /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Add the venv to the path
ENV PATH="/app/smartdrive-media-extractor/.venv/bin:$PATH"
EXPOSE 8080

WORKDIR /app/smartdrive-media-extractor
CMD ["python", "main.py"]
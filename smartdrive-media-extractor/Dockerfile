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

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# System deps (common for docling/easyocr/opencv/pdf rendering)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install uv + create venv
RUN pip install --no-cache-dir uv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

# ---- copy shared core (if your service depends on it as a path dep, it must exist before uv sync) ----
COPY smartdrive_core/ /app/smartdrive_core/

# ---- copy only lockfiles first for caching ----
ARG SERVICE_DIR=smartdrive-media-extractor
COPY ${SERVICE_DIR}/pyproject.toml ${SERVICE_DIR}/uv.lock /app/service/

WORKDIR /app/service

# Install deps from lock (no dev deps)
RUN uv sync --frozen --no-dev

# ---- now copy the service code ----
COPY ${SERVICE_DIR}/ /app/service/

# Optional: if you want the service installed as a package (only needed if you use entrypoints/import package)
# RUN uv pip install -e .

EXPOSE 8080
CMD ["uv", "run", "main.py"]
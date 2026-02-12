# Use an official Python base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (for pdfplumber, etc.)
RUN apt-get update && apt-get install -y \
    build-essential \
    poppler-utils \
    tesseract-ocr \
    libmagic1 \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose port (only needed if it’s a web server)
EXPOSE 8080

# Define entrypoint
CMD ["python", "main.py"]
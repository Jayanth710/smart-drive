# Use an official Python base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (for pdfplumber, etc.)
RUN apt-get update && apt-get install -y \
    build-essential \
    poppler-utils \
    && apt-get clean

# Install pipenv or uv if you're using it
# Replace this block if you're not using `uv`
RUN pip install uv

# Copy project files
COPY . .

# Install dependencies using uv
RUN uv pip install --system -r requirements.txt

# Expose port (only needed if it’s a web server)
# EXPOSE 8080

# Define entrypoint
CMD ["uv", "run", "main.py"]
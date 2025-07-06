# 🚀 SmartDrive: An Intelligent Content Platform

> **Your personal second brain for intelligent, privacy-first content management.**

---

## 📑 Table of Contents

1. [Introduction](#introduction)
2. [The Problem & Our Solution](#the-problem--our-solution)
3. [Technology Stack](#technology-stack)
4. [Microservice Architecture](#microservice-architecture)
5. [Features Implemented](#features-implemented)
6. [smartdrive-extractor (Documents)](#smartdrive-extractor-documents)
7. [smartdrive-image-extractor (Images)](#smartdrive-image-extractor-images)
8. [smartdrive-media-extractor (Audio--Video)](#smartdrive-media-extractor-audio--video)
9. [Local Development Setup](#local-development-setup)
10. [Environment Variables](#environment-variables)

---

## 1. Introduction

SmartDrive is a full-stack, cloud-native application designed to be your personal “second brain.” It allows you to securely upload, process, and search a wide variety of files — including documents, images, and media.  

At its core, SmartDrive uses a sophisticated AI pipeline to automatically understand file content, generate concise summaries, and make everything instantly searchable through an intuitive web interface.  

The project is built on a modern microservice architecture, ensuring scalability, resilience, and efficiency across diverse workloads — from simple document parsing to intensive audio transcription.

---

## 2. The Problem & Our Solution

In today’s world, we’re overwhelmed with unstructured data: meeting transcripts, research papers, scanned documents, personal photos, and more. Finding what you need is like searching for a needle in a haystack.  

Commercial cloud storage solutions exist — but they often lack deep content analysis and force you to trust a third party with your most sensitive data.

**SmartDrive solves this by providing an intelligent, flexible, privacy-aware AI pipeline.**

### What makes SmartDrive different?

✅ **Privacy-Aware Processing**  
Uses open-source AI models (e.g., OCR, Whisper) in a secure, containerized environment — reducing API costs and limiting raw data exposure.

✅ **Intelligent Routing**  
A local classifier analyzes images to decide between an OCR or captioning workflow, applying the best tool for the job.

✅ **State-of-the-Art Summarization & Captioning**  
For high-quality reasoning, SmartDrive uses the Google Gemini API, combining powerful third-party summarization with cost-effective local processing.

**Open-Source Models Used**:
- Document Parsing: `unstructured`
- Image OCR: `EasyOCR`
- Audio Transcription: `faster-whisper`

---

## 3. Technology Stack

| **Category**        | **Technologies**                                                                                          |
|---------------------|-----------------------------------------------------------------------------------------------------------|
| **Frontend**        | React, Next.js (App Router), TypeScript, Tailwind CSS, Axios                                              |
| **Backend**         | Node.js, Express.js, TypeScript, MongoDB, Mongoose                                                        |
| **Authentication**  | JWT (Access & Refresh Tokens), bcrypt                                                                     |
| **AI / Processing** | Python, unstructured, EasyOCR, faster-whisper, Google Gemini API                                          |
| **Database & Search** | Weaviate (Vector Database), MongoDB (Metadata)                                                          |
| **Cloud & DevOps**  | Google Cloud Platform (GCP), Docker, Cloud Run, Cloud Storage (GCS), Pub/Sub, Cloud Build, GitHub Actions |

---

## 4. Microservice Architecture

SmartDrive uses a **decoupled, event-driven architecture** for scalability and resilience.

**Data Flow:**

1. **Upload**  
   User uploads a file via the Next.js frontend.  

2. **Backend Router**  
   Node.js backend saves the file to a user-specific GCS bucket, stores metadata in MongoDB, and publishes a Pub/Sub message based on MIME type.

3. **Specialized Processing**  
   One of three Python microservices, each listening to its own Pub/Sub topic, picks up the message.

4. **Content Extraction**  
   The microservice downloads the file from GCS and uses specialized models (e.g., `unstructured`, `EasyOCR`, `faster-whisper`) to extract content.

5. **Summarization & Embedding**  
   Sends extracted content to the Google Gemini API for summarization, then creates a vector embedding.

6. **Indexing**  
   Saves the final summary, metadata, and embedding to the correct Weaviate collection.

This guarantees that, for example, a long-running transcription job will not block faster tasks like a document parse.

---

## 5. Features Implemented

### **Frontend (smartdrive-frontend)**

- Clean user registration and login forms
- Centralized state management with `AuthContext`
- Drag-and-drop file uploader with status indicators
- Federated search interface across all data types
- Personalized dashboard showing recent uploads and search results
- Secure file actions (view, download, delete)

### **Backend (smartdrive-backend)**

- Secure API endpoints for file operations
- Custom JWT authentication with bcrypt
- Authentication middleware for protected routes
- Pub/Sub message router based on MIME type
- Federated search endpoint combining multiple Weaviate collections
- Secure GCS signed URL generation for file access

---

## 6. smartdrive-extractor (Documents)

**Responsibility**: Process standard documents like `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.txt`.

**Technologies**:
- `unstructured`: advanced text parsing
- Google Gemini API: summarization

**Cloud Integration**:
- Listens to `smartdrive-data-extract-sub` Pub/Sub subscription
- Downloads files from GCS
- Saves summaries and vectors to `SmartDriveDocuments` collection in Weaviate

---

## 7. smartdrive-image-extractor (Images)

**Responsibility**: Process image files (`.png`, `.jpg`, etc.)

**Technologies**:
- OpenCV (Laplacian variance for classification)
- EasyOCR: OCR
- Google Gemini API: summarization or captioning

**Cloud Integration**:
- Listens to `smartdrive-image-extract-sub` Pub/Sub subscription
- Downloads images from GCS
- Saves results to `SmartDriveImages` collection in Weaviate

---

## 8. smartdrive-media-extractor (Audio & Video)

**Responsibility**: Process audio (`.mp3`, `.wav`) and video (`.mp4`) files

**Technologies**:
- ffmpeg: audio extraction from video
- faster-whisper: audio-to-text transcription
- Google Gemini API: summarization

**Cloud Integration**:
- Listens to `smartdrive-media-extract-sub` Pub/Sub subscription
- Downloads media files from GCS
- Saves summarized transcript + vectors to `SmartDriveMedia` collection in Weaviate

---

## 9. Local Development Setup

### **Prerequisites**

- Node.js (v18+)
- Python (v3.11+)
- Docker Desktop
- gcloud CLI
- ffmpeg

---

### **Commands**

```bash
# Authenticate with Google Cloud
gcloud auth login
gcloud auth application-default login

# Set up the backend
cd smartdrive-backend
cp .env.example .env   # or create .env as shown below
npm install
npm run dev

# Set up each Python microservice
cd smartdrive-image-extractor
python -m venv .venv
source .venv/bin/activate  # or .\.venv\Scripts\activate on Windows
pip install uv
uv sync
cp .env.example .env       # or create .env as shown below
uv run main.py

# Set up the frontend
cd smartdrive-frontend
cp .env.local.example .env.local
npm install
npm run dev

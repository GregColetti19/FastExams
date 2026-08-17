# FastExams converter service (PDF/PPTX → markdown).
#
# Docling brings large ML wheels (torch and friends), so the image lands around
# 2GB and the pip layer takes minutes on a cold build. Requirements are copied
# and installed before the source so editing main.py reuses that cached layer.

FROM python:3.11-slim

# libmagic1: python-magic's shared library (filetype sniffing).
# libgl1 + libglib2.0-0: OpenCV pulled in by Docling's layout models.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libgl1 \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Docling's layout models at build time. Otherwise the first upload
# that escalates to Docling pays a multi-hundred-MB download inside the request;
# it degrades to the MarkItDown result on timeout, so the cost is silent quality
# loss rather than an error. Non-fatal: a failure here just restores that
# lazy-download behaviour.
RUN python -c "from docling.document_converter import DocumentConverter; DocumentConverter()" || \
    echo "WARN: Docling model prefetch failed; models will download on first use"

COPY main.py .

# Railway injects PORT; 8001 matches the local default.
ENV PORT=8001
EXPOSE 8001

# One worker on purpose: conversion is CPU- and memory-heavy, and a second
# worker doubles peak RAM on a large PDF for no throughput gain at this scale.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001} --workers 1"]

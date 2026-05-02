# ── Stage 1: Build dlib + face_recognition with native libs ──────────────────
FROM python:3.11-slim AS builder

# System deps for dlib / OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libopenblas-dev liblapack-dev \
    libx11-dev libgtk-3-dev libboost-python-dev \
    libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /install
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Stage 2: Lean runtime image ───────────────────────────────────────────────
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libopenblas0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy app source
COPY . .

# Remove dev/desktop-only files
RUN rm -rf build dist .venv .git __pycache__ \
    "Smart Attendance.spec" desktop_app.py main.py

# Runtime env
ENV PORT=10000
ENV HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 10000

# Use gunicorn with multiple workers for production
CMD ["gunicorn", \
     "--bind", "0.0.0.0:10000", \
     "--workers", "2", \
     "--threads", "4", \
     "--worker-class", "gthread", \
     "--timeout", "120", \
     "--keep-alive", "5", \
     "--log-level", "info", \
     "--access-logfile", "-", \
     "attendance_app:app"]

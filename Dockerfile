FROM python:3.10-slim

WORKDIR /app

# Install system dependencies required for dlib and OpenCV
RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 10000

# Set environment variables
ENV PORT=10000
ENV HOST=0.0.0.0

# Start the application
CMD ["gunicorn", "--bind", "0.0.0.0:10000", "--timeout", "120", "attendance_app:app"]

FROM continuumio/miniconda3

WORKDIR /app

# Install dlib via conda to get pre-compiled binaries
RUN conda install -y -c conda-forge dlib

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

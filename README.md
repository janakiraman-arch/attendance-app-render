# Smart Attendance (Face Recognition)

A simple face-recognition attendance system with a Flask backend and a modern web UI. Enroll each person once, then check in with a single click; attendance is stored in SQLite (one entry per person per day).

## Features
* Enrollment from the browser (captures a frame from the webcam).
* One-click check-in with face recognition.
* Attendance log table (most recent first).
* REST API: `/api/enroll`, `/api/recognize`, `/api/attendance`.

## Requirements
* Python 3.9+
* Webcam
* System packages needed by `face_recognition` (dlib): `cmake`, `libopenblas-dev`, and a C++ build toolchain.

## Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
```bash
python attendance_app.py
```
Then open http://localhost:5000 in a browser, allow camera access, and use **Enroll Face** then **Check In**.

## Notes
* Faces are compared with a Euclidean distance threshold of `0.48`; adjust in `attendance_app.py` if needed.
* Attendance is stored in `attendance.db` at the repo root. Remove the file to reset the roster and log.
* The previous driver-drowsiness demo remains in `main.py`; it is unchanged.

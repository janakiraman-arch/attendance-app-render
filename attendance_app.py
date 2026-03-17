import base64
import io
import os
import socket
import sqlite3
from datetime import datetime, date
from pathlib import Path
from typing import List, Tuple

import cv2
import csv
import face_recognition
import numpy as np
from flask import Flask, jsonify, render_template, request, send_file

APP_ROOT = Path(__file__).parent
DB_PATH = APP_ROOT / "attendance.db"
MATCH_THRESHOLD = 0.48


def ensure_db() -> None:
    """Create tables if they do not exist."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            encoding BLOB NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            ts TEXT NOT NULL,
            day TEXT NOT NULL,
            location TEXT,
            FOREIGN KEY(person_id) REFERENCES people(id),
            UNIQUE(person_id, day)
        )
        """
    )
    
    # Migrate existing database
    try:
        conn.execute("ALTER TABLE attendance ADD COLUMN location TEXT DEFAULT 'Unknown Location'")
    except sqlite3.OperationalError:
        pass
        
    try:
        conn.execute("ALTER TABLE attendance ADD COLUMN check_out_ts TEXT")
    except sqlite3.OperationalError:
        pass
        
    conn.commit()
    conn.close()


def np_to_blob(arr: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    np.save(buffer, arr)
    return buffer.getvalue()


def blob_to_np(blob: bytes) -> np.ndarray:
    return np.load(io.BytesIO(blob), allow_pickle=False)


def decode_image(data_url: str) -> np.ndarray:
    """Decode a base64 data URL into a BGR image for OpenCV."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def fetch_known_encodings() -> List[Tuple[int, str, np.ndarray]]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, name, encoding FROM people").fetchall()
    conn.close()
    return [(row[0], row[1], blob_to_np(row[2])) for row in rows]


app = Flask(__name__, template_folder=str(APP_ROOT / "templates"), static_folder=str(APP_ROOT / "static"))

# Cached in-memory encodings; refreshed on enroll
known_faces: List[Tuple[int, str, np.ndarray]] = []


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard():
    conn = sqlite3.connect(DB_PATH)
    total_people = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
    today = date.today().isoformat()
    today_attendance = conn.execute("SELECT COUNT(*) FROM attendance WHERE day = ?", (today,)).fetchone()[0]
    
    recent_records = conn.execute(
        """
        SELECT p.name, a.ts, a.day, a.location, a.check_out_ts
        FROM attendance a
        JOIN people p ON a.person_id = p.id
        ORDER BY a.ts DESC
        LIMIT 50
        """
    ).fetchall()
    conn.close()
    
    return render_template("dashboard.html", 
        total_people=total_people,
        today_attendance=today_attendance,
        recent_records=recent_records
    )


@app.route("/api/enroll", methods=["POST"])
def enroll():
    payload = request.get_json()
    if not payload or "name" not in payload or "image" not in payload:
        return jsonify({"error": "name and image fields are required"}), 400

    name = payload["name"].strip()
    if not name:
        return jsonify({"error": "name cannot be empty"}), 400

    image_bgr = decode_image(payload["image"])
    if image_bgr is None:
        return jsonify({"error": "could not decode image"}), 400

    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb)
    if not encodings:
        return jsonify({"error": "no face detected, try again"}), 400

    encoding = encodings[0]

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT INTO people(name, encoding, created_at) VALUES (?, ?, ?)",
            (name, np_to_blob(encoding), datetime.utcnow().isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "name already exists"}), 409
    conn.close()

    # refresh cache
    global known_faces
    known_faces = fetch_known_encodings()

    return jsonify({"status": "enrolled", "name": name})


@app.route("/api/recognize", methods=["POST"])
def recognize():
    payload = request.get_json()
    if not payload or "image" not in payload:
        return jsonify({"error": "image field is required"}), 400

    if not known_faces:
        return jsonify({"error": "no enrolled faces"}), 400

    image_bgr = decode_image(payload["image"])
    if image_bgr is None:
        return jsonify({"error": "could not decode image"}), 400

    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb)
    if not encodings:
        return jsonify({"error": "no face detected"}), 400

    encoding = encodings[0]
    known_ids, known_names, known_encs = zip(*known_faces)
    distances = face_recognition.face_distance(known_encs, encoding)
    best_idx = int(np.argmin(distances))
    best_distance = float(distances[best_idx])

    if best_distance > MATCH_THRESHOLD:
        return jsonify({"matched": False, "distance": best_distance}), 404

    person_id = known_ids[best_idx]
    name = known_names[best_idx]

    location = payload.get("location", "Unknown Location")
    action = payload.get("action", "check_in")

    conn = sqlite3.connect(DB_PATH)
    today = date.today().isoformat()
    timestamp = datetime.now().isoformat(timespec="seconds")
    
    if action == "check_out":
        # Check if checked in today
        check = conn.execute("SELECT id FROM attendance WHERE person_id = ? AND day = ?", (person_id, today)).fetchone()
        if not check:
            conn.close()
            return jsonify({"error": "No check-in found for today, please check in first."}), 400
        conn.execute(
            "UPDATE attendance SET check_out_ts = ? WHERE person_id = ? AND day = ?",
            (timestamp, person_id, today),
        )
    else:
        conn.execute(
            "INSERT OR IGNORE INTO attendance(person_id, ts, day, location) VALUES (?, ?, ?, ?)",
            (person_id, timestamp, today, location),
        )
    
    conn.commit()
    conn.close()

    return jsonify({"matched": True, "name": name, "distance": best_distance, "timestamp": timestamp, "location": location, "action": action})


@app.route("/api/attendance", methods=["GET"])
def attendance():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """
        SELECT a.ts, p.name, a.location, a.check_out_ts
        FROM attendance a
        JOIN people p ON a.person_id = p.id
        ORDER BY a.ts DESC
        """
    ).fetchall()
    conn.close()
    return jsonify([{"name": row[1], "timestamp": row[0], "location": row[2] or "Unknown Location", "checkout": row[3]} for row in rows])


@app.route("/api/export", methods=["GET"])
def export_csv():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """
        SELECT p.name, a.ts, a.check_out_ts, a.day, a.location
        FROM attendance a
        JOIN people p ON a.person_id = p.id
        ORDER BY a.ts DESC
        """
    ).fetchall()
    conn.close()
    
    si = io.StringIO()
    cw = csv.writer(si)
    cw.writerow(["Name", "Check-in Time", "Check-out Time", "Date", "Location"])
    for r in rows:
        cw.writerow([r[0], r[1], r[2] if r[2] else "--", r[3], r[4] or "Unknown Location"])
        
    output = io.BytesIO()
    output.write(si.getvalue().encode('utf-8'))
    output.seek(0)
    return send_file(output, mimetype="text/csv", as_attachment=True, download_name=f"attendance_{date.today().isoformat()}.csv")


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


def startup():
    ensure_db()
    global known_faces
    known_faces = fetch_known_encodings()


startup()


def find_free_port(start_port: int, attempts: int = 10) -> int:
    """Find an available TCP port starting at start_port."""
    for port in range(start_port, start_port + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free ports available in the checked range.")


if __name__ == "__main__":
    preferred_port = int(os.environ.get("PORT", 5000))
    try:
        port = find_free_port(preferred_port)
    except RuntimeError as err:
        print("Unable to open a local port; check OS permissions or sandboxing.")
        raise err
    if port != preferred_port:
        print(f"Port {preferred_port} is busy; using {port} instead.")
    app.run(host="0.0.0.0", port=port, debug=False)

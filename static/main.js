const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const enrollBtn = document.getElementById('enrollBtn');
const checkBtn = document.getElementById('checkBtn');
const refreshBtn = document.getElementById('refreshBtn');
const tableBody = document.querySelector('#attendanceTable tbody');

function setStatus(text) {
  statusEl.textContent = text;
}

function showToast(message, ok = true) {
  toastEl.textContent = message;
  toastEl.style.borderColor = ok ? 'rgba(120,255,186,0.5)' : 'rgba(255,107,107,0.8)';
  toastEl.classList.add('show');
  speak(message);
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function speak(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    // Optional: setup voice properties like pitch, rate
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream;
    return true;
  } catch (err) {
    console.error(err);
    showToast('Enable camera to continue', false);
    return false;
  }
}

function captureFrame() {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return null;
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvasEl.toDataURL('image/jpeg', 0.9);
}

async function enroll() {
  const name = prompt('Enter full name for enrollment');
  if (!name) return;
  const frame = captureFrame();
  if (!frame) {
    showToast('Camera not ready', false);
    return;
  }
  setStatus('enrolling…');
  const res = await fetch('/api/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, image: frame })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(`Enrolled ${data.name}`);
  } else {
    showToast(data.error || 'Enroll failed', false);
  }
  setStatus('idle');
  await loadAttendance();
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve('Geolocation not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`),
      (err) => resolve('Location access denied')
    );
  });
}

async function recognize() {
  const frame = captureFrame();
  if (!frame) {
    showToast('Camera not ready', false);
    return;
  }
  setStatus('getting location…');
  const location = await getLocation();
  setStatus('checking…');
  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: frame, location })
  });
  const data = await res.json();
  if (res.ok && data.matched) {
    showToast(`Hi ${data.name}! Attendance saved.`);
  } else {
    showToast(data.error || 'No match found', false);
  }
  setStatus('idle');
  await loadAttendance();
}

async function loadAttendance() {
  const res = await fetch('/api/attendance');
  const rows = await res.json();
  tableBody.innerHTML = '';
  rows.forEach(({ name, timestamp, location }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td><td>${new Date(timestamp).toLocaleString()}</td><td>${location || 'Unknown'}</td>`;
    tableBody.appendChild(tr);
  });
}

enrollBtn.addEventListener('click', enroll);
checkBtn.addEventListener('click', recognize);
refreshBtn.addEventListener('click', loadAttendance);

(async function bootstrap() {
  await initCamera();
  await loadAttendance();
})();

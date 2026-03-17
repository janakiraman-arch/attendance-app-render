const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const enrollBtn = document.getElementById('enrollBtn');
const checkBtn = document.getElementById('checkBtn');
const checkoutBtn = document.getElementById('checkoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const tableBody = document.querySelector('#attendanceTable tbody');
const scanOverlay = document.getElementById('scanOverlay');

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // AudioContext not supported or blocked
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showToast(message, ok = true) {
  toastEl.textContent = message;
  toastEl.style.borderColor = ok ? 'rgba(120,255,186,0.5)' : 'rgba(255,107,107,0.8)';
  toastEl.classList.add('show');
  
  if (ok) playDing();
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
  
  if (scanOverlay) scanOverlay.classList.add('scanning');
  
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
  
  if (scanOverlay) scanOverlay.classList.remove('scanning');
  
  setStatus('idle');
  await loadAttendance();
}

async function getLocation() {
  try {
    // 1. Try IP-based location first (Bypasses macOS Webview permission issues entirely)
    const ipRes = await fetch('https://ipapi.co/json/');
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData.city) {
        return `${ipData.city}, ${ipData.region}`;
      }
    }
  } catch (e) {
    console.warn("IP Geolocation failed, falling back to navigator", e);
  }

  // 2. Fallback to navigator.geolocation (Only works cleanly in standard browsers, not desktop webviews)
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
          const data = await res.json();
          if (data && data.address) {
            const addr = data.address;
            const place = addr.road || addr.suburb || addr.city || addr.town || addr.village || 'Unknown';
            resolve(`${place} (${lat.toFixed(2)}, ${lon.toFixed(2)})`);
          } else {
             resolve(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
          }
        } catch (e) {
          resolve(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
      },
      (err) => reject('Location access denied. Please allow location to mark attendance.')
    );
  });
}

async function recognize(action = 'check_in') {
  const frame = captureFrame();
  if (!frame) {
    showToast('Camera not ready', false);
    return;
  }
  setStatus('getting location…');
  let location;
  try {
    location = await getLocation();
  } catch (err) {
    showToast(err, false);
    setStatus('idle');
    return;
  }
  setStatus('checking…');
  
  if (scanOverlay) scanOverlay.classList.add('scanning');
  
  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: frame, location, action })
  });
  const data = await res.json();
  if (res.ok && data.matched) {
    if (action === "check_out") {
      showToast(`Bye ${data.name}! Check-out saved.`);
    } else {
      showToast(`Hi ${data.name}! Check-in saved.`);
    }
  } else {
    showToast(data.error || 'No match found', false);
  }
  
  if (scanOverlay) scanOverlay.classList.remove('scanning');
  
  setStatus('idle');
  await loadAttendance();
}

async function loadAttendance() {
  const res = await fetch('/api/attendance');
  const rows = await res.json();
  tableBody.innerHTML = '';
  rows.forEach(({ name, timestamp, location, checkout }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td>
                    <td>${new Date(timestamp).toLocaleTimeString()}</td>
                    <td>${checkout ? new Date(checkout).toLocaleTimeString() : '--'}</td>
                    <td>${location || 'Unknown'}</td>`;
    tableBody.appendChild(tr);
  });
}

enrollBtn.addEventListener('click', enroll);
checkBtn.addEventListener('click', () => recognize('check_in'));
if (checkoutBtn) checkoutBtn.addEventListener('click', () => recognize('check_out'));
refreshBtn.addEventListener('click', loadAttendance);

(async function bootstrap() {
  await initCamera();
  await loadAttendance();
})();

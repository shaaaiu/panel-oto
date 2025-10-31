const $ = (s)=>document.querySelector(s);
const fmtRp = (n)=> new Intl.NumberFormat('id-ID').format(n);
let pollTimer = null;
let countdownTimer = null;

const paketPanel = $('#paketPanel');
const toggleBtn = $('#togglePaket');
const submitBtn = $('#submitBtn');

toggleBtn.addEventListener('click', () => {
  paketPanel.classList.toggle('hidden');
  paketPanel.classList.toggle('open');
});

// Enable submit when a paket selected
paketPanel.addEventListener('change', (e) => {
  if (e.target.name === 'paket') submitBtn.disabled = false;
});

$('#cancelBtn').addEventListener('click', async () => {
  if (!window.currentOrderId) return;
  if (!confirm('Yakin ingin membatalkan pembayaran ini?')) return;
  try {
    const res = await fetch(`/api/order/${window.currentOrderId}`, { method:'DELETE' });
    const json = await res.json();
    if (json.ok) {
      cleanupTimers();
      $('#payment').classList.add('hidden');
      $('#cancelBtn').classList.add('hidden');
      showToast('✅ Pembayaran dibatalkan.');
    } else {
      showToast(json.error || 'Gagal membatalkan.');
    }
  } catch (e) {
    showToast('Gagal membatalkan.');
  }
});

function cleanupTimers() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  window.currentOrderId = null;
}

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  cleanupTimers();
  $('#result').classList.add('hidden');
  $('#payment').classList.add('hidden');

  const fd = new FormData(e.target);
  const payload = {
    username: fd.get('username').trim(),
    paket: fd.get('paket')
  };
  if (!payload.paket) {
    showToast('Pilih paket terlebih dahulu.');
    return;
  }

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal membuat order');

    $('#payment').classList.remove('hidden');
    $('#payTotal').textContent = 'Rp' + fmtRp(json.price);
    $('#payExpiry').textContent = new Date(json.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src = json.qr_png;

    window.currentOrderId = json.orderId;
    $('#cancelBtn').classList.remove('hidden');
    startCountdown(json.expiredAt);
    startPolling(json.orderId);
  } catch (err) {
    showToast(err.message);
  }
});

function startCountdown(expiredAt) {
  const tick = () => {
    const left = Math.max(0, expiredAt - Date.now());
    const m = Math.floor(left/60000);
    const s = Math.floor((left%60000)/1000);
    $('#countdown').textContent = (left>0) ? `Sisa waktu ${m}m ${s}s` : 'Kadaluarsa';
    if (left<=0) cleanupTimers();
  };
  tick();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 1000);
}

function startPolling(orderId) {
  async function poll() {
    try {
      const res = await fetch(`/api/order/${orderId}/status`);
      const json = await res.json();
      if (!json.ok && json.status!=='error') throw new Error(json.error || 'Gagal cek status');
      if (json.status === 'success') {
        cleanupTimers();
        $('#cancelBtn').classList.add('hidden');
        showResult(json.result);
      } else if (json.status === 'expired' || json.status === 'cancelled') {
        cleanupTimers();
        $('#cancelBtn').classList.add('hidden');
        const msg = (json.status === 'expired') ? 'Pesanan kadaluarsa. Silakan buat order baru.' : 'Pesanan dibatalkan.';
        showToast(msg);
        $('#payment').classList.add('hidden');
      }
    } catch (e) {
      // ignore transient
    }
  }
  pollTimer = setInterval(poll, 5000);
  poll();
}

function showResult(r) {
  const el = $('#result');
  el.classList.remove('hidden');
  el.innerHTML = `
    <h2>Panel Siap 🎉</h2>
    <p><b>Login:</b> <a href="${r.login}" target="_blank">${r.login}</a></p>
    <p><b>Username:</b> ${r.username}</p>
    <p><b>Password:</b> ${r.password}</p>
    <p><b>RAM:</b> ${r.memory} MB • <b>CPU:</b> ${r.cpu}%</p>
    <p><b>Dibuat:</b> ${r.dibuat} WIB • <b>Expired:</b> ${r.expired}</p>
  `;
  window.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(()=> t.classList.add('hidden'), 3500);
}

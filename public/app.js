const $ = (s)=>document.querySelector(s);
const fmtRp = (n)=> new Intl.NumberFormat('id-ID').format(n);
let pollTimer = null;

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInterval(pollTimer);
  $('#result').classList.add('hidden');
  $('#payment').classList.add('hidden');

  const fd = new FormData(e.target);
  const payload = {
    username: fd.get('username').trim(),
    nomor: fd.get('nomor').trim(),
    paket: fd.get('paket')
  };

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal membuat order');

    // Show payment UI
    $('#payment').classList.remove('hidden');
    $('#payTotal').textContent = 'Rp' + fmtRp(json.price);
    $('#payExpiry').textContent = new Date(json.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src = json.qr_png;

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
    if (left<=0) clearInterval(pollTimer);
  };
  tick();
  setInterval(tick, 1000);
}

function startPolling(orderId) {
  async function poll() {
    try {
      const res = await fetch(`/api/order/${orderId}/status`);
      const json = await res.json();
      if (!json.ok && json.status!=='error') throw new Error(json.error || 'Gagal cek status');
      if (json.status === 'success') {
        clearInterval(pollTimer);
        showResult(json.result);
      } else if (json.status === 'expired') {
        clearInterval(pollTimer);
        showToast('Pesanan kadaluarsa. Silakan buat order baru.');
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

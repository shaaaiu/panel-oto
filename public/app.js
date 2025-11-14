/*  CHECK PAYMENT STATUS  */
/* —/* app.js - versi terbaru
   Fitur:
   - Riwayat pembelian per-device (localStorage)
   - Restore order saat reload (currentOrder)
   - Tombol Refresh Input (reset username & paket, tidak menghapus history)
   - Smooth modal show/hide integrasi (menggunakan .show class di index.html)
   - Mengirim total amount (harga + admin) ke API saat membuat order
*/

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmtRp = (n) => new Intl.NumberFormat('id-ID').format(n);

// --- CONFIG (ubah kalau perlu) ---
const HISTORY_KEY = 'orderHistory_v1';
const CHOSEN_KEY = 'chosenPaket_v1';
const FORM_USER_KEY = 'form_username_v1';
const CURRENT_ORDER_KEY = 'currentOrder';

// admin fee config (sesuaikan dengan sistemmu)
// contoh: adminPercent 12% + fixed admin 8 menghasilkan 2000 => +248 = 2248
const adminPercent = 0.12;
const adminFixed = 8;

// telegram notif (opsional)
const TELEGRAM_BOT = ''; // kosongkan jika tidak mau
const TELEGRAM_CHAT = '';

/* ----------------- UI ELEMENTS ----------------- */
const usernameInput = $('#usernameInput');
const openSelectorBtn = $('#openSelector');
const chosenBox = $('#chosenBox');
const submitBtn = $('#submitBtn');
const seePriceBtn = $('#seePrice');
const processingCard = $('#processing');
const paymentCard = $('#payment');
const payTotalEl = $('#payTotal');
const payExpiryEl = $('#payExpiry');
const qrcodeImg = $('#qrcode');
const countdownEl = $('#countdown');
const cancelBtn = $('#cancelBtn');
const resultCard = $('#result');
const toastEl = $('#toast');

const selectorModal = $('#selectorModal');
const priceModal = $('#priceModal');
const confirmCancelModal = $('#confirmCancel');
const historyModal = $('#historyModal');

const paketListEl = $('#paketList');
const applyChoiceBtn = $('#applyChoice');
const clearChoiceBtn = $('#clearChoice');

const historyBtn = $('#historyBtn');
const historyListEl = $('#historyList');
const clearAllHistoryBtn = $('#clearAllHistory');
const refreshFormBtn = $('#refreshFormBtn');

let chosenPaket = null;
let pollTimer = null;
let countdownTimer = null;
let currentOrderId = null;

/* ----------------- UTILITIES ----------------- */
function showToast(txt, ms = 2500) {
  if (!toastEl) return;
  toastEl.textContent = txt;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), ms);
}
function playDing() {
  const ding = document.getElementById('ding');
  if (ding) {
    ding.currentTime = 0;
    ding.play().catch(() => {});
  }
}
function openModalSmooth(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  // allow next tick then add show
  setTimeout(() => el.classList.add('show'), 10);
}
function closeModalSmooth(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.classList.add('hidden'), 190);
}

/* ----------------- PAKET DATA ----------------- */
const PAKET = [
  { key: '1gb', label: '1GB (Rp2.000)', harga: 2000, cpu: 30 },
  { key: '2gb', label: '2GB (Rp3.000)', harga: 3000, cpu: 50 },
  { key: '3gb', label: '3GB (Rp4.000)', harga: 4000, cpu: 75 },
  { key: '4gb', label: '4GB (Rp5.000)', harga: 5000, cpu: 100 },
  { key: '5gb', label: '5GB (Rp6.000)', harga: 6000, cpu: 130 },
  { key: '6gb', label: '6GB (Rp7.000)', harga: 7000, cpu: 150 },
  { key: '7gb', label: '7GB (Rp8.000)', harga: 8000, cpu: 175 },
  { key: '8gb', label: '8GB (Rp9.000)', harga: 9000, cpu: 200 },
  { key: '9gb', label: '9GB (Rp10.000)', harga: 10000, cpu: 225 },
  { key: '10gb', label: '10GB (Rp12.000)', harga: 12000, cpu: 250 },
  { key: 'unli', label: 'UNLI (Rp15.000)', harga: 15000, cpu: 500 }
];

/* render paket list inside modal */
function renderPaketList() {
  if (!paketListEl) return;
  paketListEl.innerHTML = PAKET.map(p => {
    return `<label style="display:block;padding:10px;border-radius:8px;margin-bottom:8px;cursor:pointer;border:1px dashed var(--line);">
      <input type="radio" name="paket" value="${p.key}" style="margin-right:8px"> ${p.label}
    </label>`;
  }).join('');
}

/* ----------------- HISTORY (localStorage) ----------------- */
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}
function saveHistoryItem(item) {
  const arr = getHistory();
  arr.unshift(item);
  if (arr.length > 200) arr.splice(200);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
}
function deleteHistoryIndex(i) {
  const arr = getHistory();
  if (i < 0 || i >= arr.length) return;
  arr.splice(i, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  renderHistoryList();
}
function clearAllHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryList();
}
function renderHistoryList() {
  if (!historyListEl) return;
  const arr = getHistory();
  if (!arr || arr.length === 0) {
    historyListEl.innerHTML = `<p class="muted">Belum ada riwayat pembelian di perangkat ini.</p>`;
    return;
  }
  historyListEl.innerHTML = arr.map((it, idx) => {
    return `
    <div style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:10px;align-items:flex-start;justify-content:space-between;">
      <div>
        <div style="font-weight:600">${it.username || '-' } • ${it.paket?.toUpperCase() || '-'}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">Dibuat: ${it.dibuat || '-'} • Exp: ${it.expired || '-'}</div>
        <div style="font-size:13px;margin-top:6px">Login: <a href="${it.login}" target="_blank">${it.login}</a></div>
      </div>
      <div style="min-width:110px;text-align:right;display:flex;flex-direction:column;gap:6px;">
        <button class="secondary copyBtn" data-idx="${idx}" style="padding:6px 8px">Copy Login</button>
        <button class="ghost delBtn" data-idx="${idx}" style="padding:6px 8px">Hapus</button>
      </div>
    </div>`;
  }).join('');

  // attach handlers
  historyListEl.querySelectorAll('.copyBtn').forEach(b => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.idx);
      const arr = getHistory();
      const it = arr[i];
      if (!it) return;
      const text = `Login: ${it.login}\nUser: ${it.username}\nPass: ${it.password || '-'}`;
      navigator.clipboard?.writeText(text).then(() => showToast('Login disalin ke clipboard'));
    });
  });
  historyListEl.querySelectorAll('.delBtn').forEach(b => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.idx);
      if (!confirm('Hapus riwayat ini?')) return;
      deleteHistoryIndex(i);
    });
  });
}

/* ----------------- HELPERS ----------------- */
function calcAdmin(price) {
  // round admin part to nearest integer
  return Math.round(price * adminPercent) + adminFixed;
}
function calcTotal(price) {
  return price + calcAdmin(price);
}

/* ----------------- API HELPERS ----------------- */
async function createOrderOnServer(payload) {
  // payload should contain: username, paket, amount (optional)
  // server may ignore amount; ideally server will use amount
  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('createOrderOnServer err', err);
    throw err;
  }
}
async function getOrderStatus(orderId) {
  try {
    const res = await fetch(`/api/order/${orderId}/status`);
    return await res.json();
  } catch (err) {
    console.error('getOrderStatus err', err);
    return { status: 'error' };
  }
}
async function cancelOrderOnServer(orderId){
  try{
    await fetch(`/api/order/${orderId}`, { method: 'DELETE' }).catch(()=>{});
  }catch(e){}
}

/* ----------------- POLLING & COUNTDOWN ----------------- */
function startCountdown(expTs) {
  if (countdownTimer) clearInterval(countdownTimer);
  function tick() {
    const left = expTs - Date.now();
    if (left <= 0) {
      countdownEl.textContent = 'Kadaluarsa';
      clearInterval(countdownTimer);
      // cleanup pending
      localStorage.removeItem(CURRENT_ORDER_KEY);
      submitBtn.disabled = false;
      return;
    }
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    countdownEl.textContent = `Sisa ${mm}m ${ss}s`;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling(orderId) {
  stopPolling();
  currentOrderId = orderId;
  pollTimer = setInterval(async () => {
    try {
      const j = await getOrderStatus(orderId);
      // expected j.status: success | pending | expired
      if (!j) return;
      if (j.status === 'success') {
        stopPolling();
        // show result
        paymentCard.classList.add('hidden');
        // show result and save history
        showResult(j.result || j.data || {});
        // save to history (use best-effort keys)
        const p = PAKET.find(x => x.key === (j.result?.paket || localStorage.getItem(CHOSEN_KEY))) || {};
        saveHistoryItem({
          username: j.result?.username || j.result?.user || localStorage.getItem(FORM_USER_KEY) || '',
          password: j.result?.password || j.result?.pass || '',
          login: j.result?.login || j.result?.panel_url || '#',
          expired: j.result?.expired || new Date(j.result?.expiredAt || Date.now()).toLocaleString('id-ID'),
          memory: j.result?.memory || j.result?.ram || '',
          cpu: j.result?.cpu || p.cpu || '',
          dibuat: j.result?.dibuat || new Date().toLocaleString('id-ID'),
          paket: j.result?.paket || p.key || localStorage.getItem(CHOSEN_KEY) || '',
          waktu_order: new Date().toLocaleString('id-ID')
        });
        localStorage.removeItem(CURRENT_ORDER_KEY);
        currentOrderId = null;
        submitBtn.disabled = false;
        playDing();
        showToast('Pembayaran terkonfirmasi! Panel siap.');
      } else if (j.status === 'expired') {
        stopPolling();
        localStorage.removeItem(CURRENT_ORDER_KEY);
        currentOrderId = null;
        paymentCard.classList.add('hidden');
        submitBtn.disabled = false;
        showToast('Order kadaluarsa.');
      } else {
        // pending - do nothing
      }
    } catch (err) {
      console.error('poll err', err);
    }
  }, 4000);
}

/* ----------------- RESULT UI ----------------- */
function showResult(data) {
  if (!resultCard) return;
  const username = data.username || data.user || '';
  const password = data.password || data.pass || '';
  const login = data.login || data.panel_url || '#';
  const memory = data.memory || data.ram || '-';
  const cpu = data.cpu || '-';
  const dibuat = data.dibuat || new Date().toLocaleString('id-ID');
  const expired = data.expired || new Date(data.expiredAt || Date.now()).toLocaleString('id-ID');

  resultCard.classList.remove('hidden');
  resultCard.innerHTML = `
    <h2>Panel Siap 🎉</h2>
    <p><b>Login:</b> <a href="${login}" target="_blank">${login}</a></p>
    <p><b>Username:</b> ${username}</p>
    <p><b>Password:</b> ${password}</p>
    <p><b>RAM:</b> ${memory} • <b>CPU:</b> ${cpu}%</p>
    <p><b>Dibuat:</b> ${dibuat}</p>
    <p><b>Expired:</b> ${expired}</p>
  `;
  resultCard.scrollIntoView({ behavior: 'smooth' });
}

/* ----------------- EVENT BINDINGS ----------------- */

// render paket list on load
renderPaketList();

// open selector
openSelectorBtn.addEventListener('click', () => {
  openModalSmooth('selectorModal');
  // set radio if chosen
  const c = localStorage.getItem(CHOSEN_KEY);
  if (c) {
    const el = document.querySelector(`#paketList input[value="${c}"]`);
    if (el) el.checked = true;
    chosenPaket = c;
    $('#applyChoice').disabled = !chosenPaket;
  }
});

// modal close
$('#closeModal').addEventListener('click', () => closeModalSmooth('selectorModal'));
$$('.modal-backdrop').forEach(b => b.addEventListener('click', (e) => {
  const modal = b.closest('.modal');
  if (modal) closeModalSmooth(modal.id);
}));

// paket selection inside modal
paketListEl.addEventListener('change', (ev) => {
  const cur = paketListEl.querySelector('input[name="paket"]:checked');
  chosenPaket = cur ? cur.value : null;
  $('#applyChoice').disabled = !chosenPaket;
});

// clear choice
clearChoiceBtn.addEventListener('click', () => {
  chosenPaket = null;
  paketListEl.querySelectorAll('input[name="paket"]').forEach(i => i.checked = false);
  $('#applyChoice').disabled = true;
});

// apply choice
applyChoiceBtn.addEventListener('click', () => {
  if (!chosenPaket) return;
  const p = PAKET.find(x => x.key === chosenPaket);
  chosenBox.classList.remove('hidden');
  chosenBox.textContent = p ? p.label : chosenPaket;
  seePriceBtn.classList.remove('hidden');
  submitBtn.disabled = false;
  // persist chosen paket
  localStorage.setItem(CHOSEN_KEY, chosenPaket);
  closeModalSmooth('selectorModal');
});

// see price
seePriceBtn.addEventListener('click', () => {
  if (!chosenPaket) return;
  const p = PAKET.find(x => x.key === chosenPaket) || {};
  const admin = calcAdmin(p.harga || 0);
  const total = calcTotal(p.harga || 0);
  $('#priceDetail').innerHTML = `
    <p><b>Paket:</b> ${p.label || chosenPaket}</p>
    <p><b>Harga paket:</b> Rp${fmtRp(p.harga || 0)}</p>
    <p><b>Biaya admin:</b> Rp${fmtRp(admin)}</p>
    <p style="margin-top:8px;"><b>Total yang akan dibayar:</b> Rp${fmtRp(total)}</p>
  `;
  openModalSmooth('priceModal');
});
$('#closePrice').addEventListener('click', () => closeModalSmooth('priceModal'));

// cancel payment
cancelBtn.addEventListener('click', () => openModalSmooth('confirmCancel'));
$('#noCancel').addEventListener('click', () => closeModalSmooth('confirmCancel'));
$('#yesCancel').addEventListener('click', async () => {
  closeModalSmooth('confirmCancel');
  if (currentOrderId) {
    await cancelOrderOnServer(currentOrderId).catch(()=>{});
  }
  stopPolling();
  if (countdownTimer) clearInterval(countdownTimer);
  currentOrderId = null;
  localStorage.removeItem(CURRENT_ORDER_KEY);
  paymentCard.classList.add('hidden');
  submitBtn.disabled = false;
  showToast('Pembayaran dibatalkan.');
});

// history modal open
historyBtn.addEventListener('click', () => {
  renderHistoryList();
  openModalSmooth('historyModal');
});
$('#closeHistory').addEventListener('click', () => closeModalSmooth('historyModal'));
$('#closeHistoryOk').addEventListener('click', () => closeModalSmooth('historyModal'));
clearAllHistoryBtn.addEventListener('click', () => {
  if (!confirm('Hapus semua riwayat di perangkat ini?')) return;
  clearAllHistory();
  showToast('Riwayat dibersihkan.');
});

// refresh input button (reset username & chosen paket; tetap menyimpan history)
refreshFormBtn.addEventListener('click', () => {
  if (!confirm('Reset input username & paket? (Riwayat pembelian tidak akan dihapus)')) return;
  usernameInput.value = '';
  localStorage.removeItem(FORM_USER_KEY);

  chosenPaket = null;
  localStorage.removeItem(CHOSEN_KEY);
  chosenBox.classList.add('hidden');
  seePriceBtn.classList.add('hidden');

  submitBtn.disabled = true;
  showToast('Form telah direset.');
});

// save username auto
usernameInput.addEventListener('input', (e) => {
  localStorage.setItem(FORM_USER_KEY, e.target.value);
  // enable submit if paket chosen
  if ((chosenPaket || localStorage.getItem(CHOSEN_KEY)) && e.target.value.trim().length >= 3) {
    submitBtn.disabled = false;
  } else {
    submitBtn.disabled = true;
  }
});

/* ----------------- SUBMIT FLOW ----------------- */
$('#orderForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const username = (new FormData(ev.target)).get('username')?.trim();
  if (!username) return showToast('Isi username terlebih dahulu.');
  const paketKey = chosenPaket || localStorage.getItem(CHOSEN_KEY);
  if (!paketKey) return showToast('Pilih paket terlebih dahulu.');

  // If there is pending order stored, restore view instead of creating another
  const pending = JSON.parse(localStorage.getItem(CURRENT_ORDER_KEY) || 'null');
  if (pending && pending.orderId && (new Date(pending.expiredAt)).getTime() > Date.now()) {
    showToast('Masih ada order yang belum selesai. Mengalihkan ke tampilan pembayaran...');
    restorePendingOrderState(pending);
    return;
  }

  submitBtn.disabled = true;
  processingCard.classList.remove('hidden');
  paymentCard.classList.add('hidden');
  resultCard.classList.add('hidden');

  const paketObj = PAKET.find(x => x.key === paketKey);
  const basePrice = paketObj ? paketObj.harga : 0;
  const adminFee = calcAdmin(basePrice);
  const totalAmount = calcTotal(basePrice);

  try {
    // send paket/payload and include amount so payment gateway create QRIS with correct total
    const payload = {
      username,
      paket: paketKey,
      amount: totalAmount,   // important: send total
      meta: {
        basePrice,
        adminFee
      }
    };
    const j = await createOrderOnServer(payload);
    processingCard.classList.add('hidden');

    if (!j || !j.ok) {
      submitBtn.disabled = false;
      showToast(j?.error || 'Gagal membuat order.');
      return;
    }

    // server returns orderId, price, expiredAt, qr_png (best effort)
    const orderId = j.orderId || j.data?.orderId || j.id;
    const priceShownOnServer = j.price || j.data?.price || totalAmount;
    const expiredAt = j.expiredAt || j.data?.expiredAt || (Date.now() + (5 * 60 * 1000)); // fallback 5 minutes
    const qr_png = j.qr_png || j.data?.qr_png || j.qr || '';

    // persist current order so if user reload page we can restore
    const persistent = {
      orderId,
      price: priceShownOnServer,
      expiredAt,
      username,
      paket: paketKey,
      qr_png
    };
    localStorage.setItem(CURRENT_ORDER_KEY, JSON.stringify(persistent));
    window.currentOrderId = orderId;

    // show payment UI
    paymentCard.classList.remove('hidden');
    payTotalEl.textContent = 'Rp' + fmtRp(priceShownOnServer);
    payExpiryEl.textContent = new Date(expiredAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    qrcodeImg.src = qr_png || '';
    startCountdown(Number(expiredAt));
    startPolling(orderId);

    // optionally notify telegram
    if (TELEGRAM_BOT && TELEGRAM_CHAT) {
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: `Order baru: ${username}\nPaket: ${paketKey}\nTotal: ${priceShownOnServer}` })
      }).catch(()=>{});
    }
  } catch (err) {
    console.error(err);
    showToast('Terjadi kesalahan jaringan.');
    processingCard.classList.add('hidden');
    submitBtn.disabled = false;
  }
});

/* ----------------- RESTORE ON LOAD ----------------- */
function restorePendingOrderState(state) {
  if (!state) return;
  try {
    const expTs = Number(state.expiredAt) || new Date(state.expiredAt).getTime();
    paymentCard.classList.remove('hidden');
    payTotalEl.textContent = 'Rp' + fmtRp(state.price || 0);
    payExpiryEl.textContent = new Date(expTs).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    qrcodeImg.src = state.qr_png || '';
    startCountdown(expTs);
    startPolling(state.orderId);
    submitBtn.disabled = true;
  } catch (e) {
    console.error('restorePendingOrderState err', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // restore chosen paket & username
  const savedP = localStorage.getItem(CHOSEN_KEY);
  if (savedP) {
    chosenPaket = savedP;
    const p = PAKET.find(x => x.key === savedP);
    if (p) {
      chosenBox.classList.remove('hidden');
      chosenBox.textContent = p.label;
      seePriceBtn.classList.remove('hidden');
      submitBtn.disabled = !(usernameInput.value && usernameInput.value.trim().length >= 3);
    }
  }
  const savedUser = localStorage.getItem(FORM_USER_KEY);
  if (savedUser) usernameInput.value = savedUser;

  // restore pending order if exists
  const pending = JSON.parse(localStorage.getItem(CURRENT_ORDER_KEY) || 'null');
  if (pending && pending.orderId) {
    const expTs = Number(pending.expiredAt) || new Date(pending.expiredAt).getTime();
    if (expTs > Date.now()) {
      restorePendingOrderState(pending);
      showToast('Memulihkan order yang belum selesai...');
    } else {
      localStorage.removeItem(CURRENT_ORDER_KEY);
    }
  }

  // attach backdrop close for history modal too
  document.querySelectorAll('.modal').forEach(m => {
    // ensure close buttons already wired, but if click outside content close as well (handled earlier)
  });
});

/* ----------------- Small UX polish: enable submit if username & paket present ----------------- */
usernameInput.addEventListener('input', () => {
  const v = usernameInput.value.trim();
  if (!v) {
    submitBtn.disabled = true;
  } else {
    const pKey = chosenPaket || localStorage.getItem(CHOSEN_KEY);
    submitBtn.disabled = !pKey;
  }
});

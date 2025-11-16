/*  CHECK PAYMENT STATUS  */
/* —/* app.js - versi terbaru
   Fitur tambahan:
   - Nomor telepon pembeli
   - Phone terkirim ke server + tampil di result + masuk history
   - Validasi phone
   - Telegram notif ikut kirim nomor
*/

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmtRp = (n) => new Intl.NumberFormat('id-ID').format(n);

// --- CONFIG (ubah kalau perlu) ---
const HISTORY_KEY = 'orderHistory_v1';
const CHOSEN_KEY = 'chosenPaket_v1';
const FORM_USER_KEY = 'form_username_v1';
const FORM_PHONE_KEY = 'form_phone_v1';   // === PHONE UPDATE ===
const CURRENT_ORDER_KEY = 'currentOrder';

const adminPercent = 0.12;
const adminFixed = 8;

// telegram notif
const TELEGRAM_BOT = '8105677831:AAFRyE6rRbIi3E9riMBIkaSA0Ya_lfT9tWg';
const TELEGRAM_CHAT = '5254873680';

/* ----------------- UI ELEMENTS ----------------- */
const usernameInput = $('#usernameInput');
const phoneInput = $('#phoneInput');   // === PHONE UPDATE ===
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
  toastEl.textContent = txt;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), ms);
}
function playDing() {
  const ding = document.getElementById('ding');
  if (ding) ding.play().catch(() => {});
}

function openModalSmooth(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('show'), 10);
}
function closeModalSmooth(id) {
  const el = document.getElementById(id);
  el.classList.remove('show');
  setTimeout(() => el.classList.add('hidden'), 170);
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

function renderPaketList() {
  paketListEl.innerHTML = PAKET.map(p => {
    return `<label style="display:block;padding:10px;border-radius:8px;margin-bottom:8px;cursor:pointer;border:1px dashed var(--line);">
      <input type="radio" name="paket" value="${p.key}" style="margin-right:8px"> ${p.label}
    </label>`;
  }).join('');
}

/* ----------------- HISTORY ----------------- */
function getHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}
function saveHistoryItem(item) {
  const arr = getHistory();
  arr.unshift(item);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, 200)));
}
function renderHistoryList() {
  const arr = getHistory();
  if (!arr.length) {
    historyListEl.innerHTML = `<p class="muted">Belum ada riwayat.</p>`;
    return;
  }
  historyListEl.innerHTML = arr.map((it) => `
    <div style="padding:10px;border-bottom:1px solid #333">
      <b>${it.username}</b> • ${it.paket.toUpperCase()}
      <div class="muted" style="font-size:12px">Nomor: ${it.phone || '-'}</div>
      <div style="font-size:12px">Login: <a href="${it.login}" target="_blank">${it.login}</a></div>
    </div>
  `).join('');
}

/* ----------------- CALC ----------------- */
function calcAdmin(price) {
  return Math.round(price * adminPercent) + adminFixed;
}
function calcTotal(price) {
  return price + calcAdmin(price);
}

/* ----------------- API ----------------- */
async function createOrderOnServer(payload) {
  const res = await fetch('/api/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}
async function getOrderStatus(orderId) {
  const res = await fetch(`/api/order/${orderId}/status`);
  return res.json();
}
async function cancelOrderOnServer(id) {
  return fetch(`/api/order/${id}`, { method: 'DELETE' });
}

/* ----------------- COUNTDOWN ----------------- */
function startCountdown(expTs) {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const sisa = expTs - Date.now();
    if (sisa <= 0) {
      countdownEl.textContent = "Kadaluarsa";
      clearInterval(countdownTimer);
      return;
    }
    const mm = Math.floor(sisa / 60000);
    const ss = Math.floor((sisa % 60000) / 1000);
    countdownEl.textContent = `Sisa ${mm}m ${ss}s`;
  }, 1000);
}

/* ----------------- RESULT ----------------- */
function showResult(data) {
  resultCard.classList.remove('hidden');
  resultCard.innerHTML = `
    <h2>Panel Siap 🎉</h2>
    <p><b>Nomor:</b> ${data.phone || '-'}</p>
    <p><b>Username:</b> ${data.username}</p>
    <p><b>Password:</b> ${data.password}</p>
    <p><b>Login:</b> <a href="${data.login}" target="_blank">${data.login}</a></p>
    <p><b>RAM:</b> ${data.memory} MB</p>
    <p><b>CPU:</b> ${data.cpu}%</p>
    <p><b>Expired:</b> ${data.expired}</p>
  `;
}

/* ----------------- POLLING ----------------- */
function startPolling(orderId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const st = await getOrderStatus(orderId);
    if (st.status === 'success') {
      clearInterval(pollTimer);
      paymentCard.classList.add('hidden');

      // === SAVE HISTORY ===
      saveHistoryItem({
        username: st.result.username,
        phone: st.result.phone, // === PHONE UPDATE ===
        paket: st.result.tagihan?.paket || '',
        login: st.result.login,
        expired: st.result.expired,
        password: st.result.password
      });

      showResult(st.result);
      localStorage.removeItem(CURRENT_ORDER_KEY);
      playDing();
      showToast('Pembayaran sukses!');
    }
  }, 4000);
}

/* ----------------- SUBMIT ----------------- */
$('#orderForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();

  const username = usernameInput.value.trim();
  const phone = phoneInput.value.trim(); // === PHONE UPDATE ===
  const paketKey = chosenPaket || localStorage.getItem(CHOSEN_KEY);

  if (!username) return showToast('Username wajib diisi');
  if (!phone.match(/^[0-9]{8,15}$/)) return showToast('Nomor telepon tidak valid'); // === PHONE UPDATE ===
  if (!paketKey) return showToast('Pilih paket dulu');

  const paketObj = PAKET.find(x => x.key === paketKey);
  const totalAmount = calcTotal(paketObj.harga);

  processingCard.classList.remove('hidden');
  paymentCard.classList.add('hidden');
  resultCard.classList.add('hidden');

  const createPayload = {
    username,
    phone,        // === PHONE UPDATE ===
    paket: paketKey,
    amount: totalAmount
  };

  const j = await createOrderOnServer(createPayload);
  processingCard.classList.add('hidden');

  if (!j.ok) return showToast(j.error || 'Gagal membuat order');

  currentOrderId = j.orderId;

  // save current order state
  localStorage.setItem(
    CURRENT_ORDER_KEY,
    JSON.stringify({
      orderId: j.orderId,
      expiredAt: j.expiredAt,
      price: j.price,
      username,
      phone,
      paket: paketKey,
      qr_png: j.qr_png
    })
  );

  paymentCard.classList.remove('hidden');
  payTotalEl.textContent = 'Rp' + fmtRp(j.price);
  payExpiryEl.textContent = j.paymentExpiredAt;
  qrcodeImg.src = j.qr_png;

  startCountdown(j.expiredAt);
  startPolling(j.orderId);

  // telegram notif
  if (TELEGRAM_BOT && TELEGRAM_CHAT) {
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT,
        text: `Order Baru
Username: ${username}
Nomor: ${phone}
Paket: ${paketKey}
Total: Rp${fmtRp(j.price)}`
      })
    });
  }
});

/* ----------------- RESTORE ON LOAD ----------------- */
window.addEventListener('DOMContentLoaded', () => {
  const saved = JSON.parse(localStorage.getItem(CURRENT_ORDER_KEY) || "null");
  const savedPhone = localStorage.getItem(FORM_PHONE_KEY);   // === PHONE UPDATE ===
  const savedUser = localStorage.getItem(FORM_USER_KEY);

  if (savedUser) usernameInput.value = savedUser;
  if (savedPhone) phoneInput.value = savedPhone;              // === PHONE UPDATE ===

  if (saved) {
    paymentCard.classList.remove('hidden');
    payTotalEl.textContent = 'Rp' + fmtRp(saved.price);
    qrcodeImg.src = saved.qr_png;

    startCountdown(saved.expiredAt);
    startPolling(saved.orderId);

    submitBtn.disabled = true;
  }
});

// auto save phone
phoneInput.addEventListener('input', () => {                 // === PHONE UPDATE ===
  localStorage.setItem(FORM_PHONE_KEY, phoneInput.value);
});

// auto save username
usernameInput.addEventListener('input', () => {
  localStorage.setItem(FORM_USER_KEY, usernameInput.value);
});

// show history
historyBtn.addEventListener('click', () => {
  renderHistoryList();
  openModalSmooth('historyModal');
});

/* END FILE */

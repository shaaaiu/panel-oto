/* ============================================================
   app.js FINAL — Fully working version (with History enabled)
   Features:
   - Paket selector
   - LocalStorage save (username, history, chosen paket)
   - Restore pending payment
   - Payment countdown + polling
   - Purchase history fully working
   - Works with your Requime server.js
===============================================================*/

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmtRp = (n) => new Intl.NumberFormat('id-ID').format(n);

// KEYS
const HISTORY_KEY = "history_v2";
const CHOSEN_KEY = "chosenPaket";
const FORM_USER_KEY = "savedUsername";
const FORM_PHONE_KEY = "savedPhone";
const CURRENT_ORDER_KEY = "currentOrder";

// ELEMENTS
const usernameInput = $('#usernameInput');
const phoneInput = $('#phoneInput');
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

/* ============================================================
   PAKET LIST
===============================================================*/
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

/* ============================================================
   UTILITIES
===============================================================*/
function showToast(txt, ms = 2500) {
  toastEl.textContent = txt;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function openModalSmooth(id) {
  const el = document.getElementById(id);
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("show"), 10);
}

function closeModalSmooth(id) {
  const el = document.getElementById(id);
  el.classList.remove("show");
  setTimeout(() => el.classList.add("hidden"), 190);
}

/* ============================================================
   HISTORY SYSTEM
===============================================================*/
function saveHistory(item) {
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  list.push(item);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function loadHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
}

function renderHistory() {
  const list = loadHistory();
  if (!list.length) {
    historyListEl.innerHTML = '<p class="muted">Belum ada riwayat.</p>';
    return;
  }

  historyListEl.innerHTML = list.map((x) => `
    <div style="padding:12px;border-bottom:1px solid #ffffff11">
      <p><b>Username:</b> ${x.username}</p>
      <p><b>Phone:</b> ${x.phone}</p>
      <p><b>Paket:</b> ${x.paket}</p>
      <p><b>Total:</b> Rp${fmtRp(x.total)}</p>
      <p><b>Tanggal:</b> ${x.tanggal}</p>
      <hr>
      <p><b>Login:</b> ${x.result.login}</p>
      <p><b>User:</b> ${x.result.username}</p>
      <p><b>Pass:</b> ${x.result.password}</p>
      <p><b>RAM:</b> ${x.result.memory}</p>
      <p><b>CPU:</b> ${x.result.cpu}%</p>
      <p><b>Expired:</b> ${x.result.expired}</p>
    </div>
  `).join("");
}

clearAllHistoryBtn.addEventListener("click", () => {
  if (confirm("Hapus seluruh riwayat pembelian?")) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    showToast("Riwayat dibersihkan.");
  }
});

/* ============================================================
   RENDER PAKET LIST
===============================================================*/
function renderPaketList() {
  paketListEl.innerHTML = PAKET.map(p => `
    <label style="display:block;padding:10px;margin-bottom:8px;border:1px dashed #fff3;border-radius:8px;">
      <input type="radio" name="paket" value="${p.key}" /> ${p.label}
    </label>
  `).join("");
}
renderPaketList();

/* ============================================================
   SELECTOR MODAL
===============================================================*/
openSelectorBtn.addEventListener("click", () => {
  openModalSmooth("selectorModal");
  const saved = localStorage.getItem(CHOSEN_KEY);
  if (saved) {
    const el = document.querySelector(`input[value="${saved}"]`);
    if (el) el.checked = true;
    chosenPaket = saved;
    applyChoiceBtn.disabled = false;
  }
});

paketListEl.addEventListener("change", () => {
  const cur = paketListEl.querySelector("input:checked");
  chosenPaket = cur ? cur.value : null;
  applyChoiceBtn.disabled = !chosenPaket;
});

applyChoiceBtn.addEventListener("click", () => {
  if (!chosenPaket) return;
  const p = PAKET.find(x => x.key === chosenPaket);
  chosenBox.classList.remove("hidden");
  chosenBox.textContent = p.label;
  seePriceBtn.classList.remove("hidden");

  localStorage.setItem(CHOSEN_KEY, chosenPaket);
  submitBtn.disabled = !(usernameInput.value.trim().length >= 3 && phoneInput.value.trim().length >= 5);
  closeModalSmooth("selectorModal");
});

clearChoiceBtn.addEventListener("click", () => {
  chosenPaket = null;
  paketListEl.querySelectorAll("input").forEach(i => (i.checked = false));
  applyChoiceBtn.disabled = true;
});

/* ============================================================
   PRICE MODAL
===============================================================*/
seePriceBtn.addEventListener("click", () => {
  const p = PAKET.find(x => x.key === chosenPaket);
  $('#priceDetail').innerHTML = `
    <p><b>Paket:</b> ${p.label}</p>
    <p><b>Harga Dasar:</b> Rp${fmtRp(p.harga)}</p>
  `;
  openModalSmooth("priceModal");
});

$('#closePrice').addEventListener("click", () => closeModalSmooth("priceModal"));

/* ============================================================
   PAYMENT FLOW
===============================================================*/
async function createOrder(payload) {
  const res = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

async function getOrderStatus(id) {
  const res = await fetch(`/api/order/${id}/status`);
  return await res.json();
}

/* ============================================================
   SUBMIT ORDER
===============================================================*/
$('#orderForm').addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const username = usernameInput.value.trim();
  const phone = phoneInput.value.trim();

  if (!username || !phone || !chosenPaket)
    return showToast("Isi semua data.");

  submitBtn.disabled = true;
  processingCard.classList.remove("hidden");

  try {
    const j = await createOrder({ username, phone, paket: chosenPaket });

    processingCard.classList.add("hidden");

    if (!j.ok) {
      submitBtn.disabled = false;
      return showToast(j.error || "Gagal membuat order.");
    }

    const { orderId, price, expiredAt, qr_png } = j;

    localStorage.setItem(
      CURRENT_ORDER_KEY,
      JSON.stringify({ orderId, price, expiredAt, qr_png })
    );

    paymentCard.classList.remove("hidden");
    payTotalEl.textContent = "Rp" + fmtRp(price);
    payExpiryEl.textContent = new Date(expiredAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    qrcodeImg.src = qr_png;

    startCountdown(expiredAt);
    startPolling(orderId);

  } catch (err) {
    showToast("Error jaringan.");
    processingCard.classList.add("hidden");
    submitBtn.disabled = false;
  }
});

/* ============================================================
   COUNTDOWN + POLLING
===============================================================*/
function startCountdown(expTs) {
  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    const left = expTs - Date.now();
    if (left <= 0) {
      countdownEl.textContent = "Kadaluarsa";
      clearInterval(countdownTimer);
      return;
    }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    countdownEl.textContent = `Sisa ${m}m ${s}s`;
  }, 1000);
}

function startPolling(orderId) {
  pollTimer = setInterval(async () => {
    const j = await getOrderStatus(orderId);

    if (j.status === "success") {
      clearInterval(pollTimer);

      paymentCard.classList.add("hidden");

      showResult(j.result);

      // SAVE HISTORY
      saveHistory({
        username: j.result.username,
        phone: phoneInput.value,
        paket: chosenPaket,
        total: j.result.tagihan.total,
        tanggal: new Date().toLocaleString("id-ID"),
        result: j.result
      });

      localStorage.removeItem(CURRENT_ORDER_KEY);

      showToast("Pembayaran berhasil!");
    }

    if (j.status === "expired") {
      clearInterval(pollTimer);
      paymentCard.classList.add("hidden");
      submitBtn.disabled = false;
      showToast("Order kadaluarsa.");
    }
  }, 4000);
}

/* ============================================================
   SHOW RESULT
===============================================================*/
function showResult(r) {
  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <h2>Panel Siap 🎉</h2>
    <p><b>Login:</b> <a href="${r.login}" target="_blank">${r.login}</a></p>
    <p><b>Username:</b> ${r.username}</p>
    <p><b>Password:</b> ${r.password}</p>
    <p><b>RAM:</b> ${r.memory}</p>
    <p><b>CPU:</b> ${r.cpu}%</p>
    <p><b>Expired:</b> ${r.expired}</p>
  `;
}

/* ============================================================
   HISTORY MODAL BUTTON
===============================================================*/
historyBtn.addEventListener("click", () => {
  renderHistory();
  openModalSmooth("historyModal");
});

$('#closeHistory').addEventListener("click", () => closeModalSmooth("historyModal"));
$('#closeHistoryOk').addEventListener("click", () => closeModalSmooth("historyModal"));

/* ============================================================
   RESTORE PENDING ORDER WHEN PAGE LOAD
===============================================================*/
window.addEventListener("DOMContentLoaded", () => {
  const savedUser = localStorage.getItem(FORM_USER_KEY);
  if (savedUser) usernameInput.value = savedUser;

  const savedPhone = localStorage.getItem(FORM_PHONE_KEY);
  if (savedPhone) phoneInput.value = savedPhone;

  const savedPaket = localStorage.getItem(CHOSEN_KEY);
  if (savedPaket) {
    chosenPaket = savedPaket;
    const p = PAKET.find(x => x.key === savedPaket);
    chosenBox.classList.remove("hidden");
    chosenBox.textContent = p.label;
    seePriceBtn.classList.remove("hidden");
  }

  // Restore pending order
  const pending = JSON.parse(localStorage.getItem(CURRENT_ORDER_KEY) || "null");
  if (pending && pending.orderId) {
    paymentCard.classList.remove("hidden");

    payTotalEl.textContent = "Rp" + fmtRp(pending.price);
    payExpiryEl.textContent = new Date(pending.expiredAt).toLocaleTimeString("id-ID");

    qrcodeImg.src = pending.qr_png;

    startCountdown(pending.expiredAt);
    startPolling(pending.orderId);
    submitBtn.disabled = true;
  }
});

/* SAVE INPUT TO STORAGE */
usernameInput.addEventListener("input", () => {
  localStorage.setItem(FORM_USER_KEY, usernameInput.value.trim());
});

phoneInput.addEventListener("input", () => {
  localStorage.setItem(FORM_PHONE_KEY, phoneInput.value.trim());
});

/* REFRESH FORM */
refreshFormBtn.addEventListener("click", () => {
  if (confirm("Reset input? Riwayat tidak akan dihapus.")) {
    usernameInput.value = "";
    phoneInput.value = "";
    localStorage.removeItem(FORM_USER_KEY);
    localStorage.removeItem(FORM_PHONE_KEY);

    chosenPaket = null;
    localStorage.removeItem(CHOSEN_KEY);
    chosenBox.classList.add("hidden");
    seePriceBtn.classList.add("hidden");

    submitBtn.disabled = true;
    showToast("Form direset.");
  }
});

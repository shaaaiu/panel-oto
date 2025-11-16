// app.js - versi simpel tapi lengkap
// Flow: isi username + phone -> pilih paket -> buat QRIS -> cek status

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmtRp = (n) => new Intl.NumberFormat("id-ID").format(n);

// ELEMENT DOM
const usernameInput = $("#usernameInput");
const phoneInput = $("#phoneInput");
const openSelectorBtn = $("#openSelector");
const chosenBox = $("#chosenBox");
const seePriceBtn = $("#seePrice");
const submitBtn = $("#submitBtn");
const refreshFormBtn = $("#refreshFormBtn");

const processingCard = $("#processing");
const paymentCard = $("#payment");
const payTotalEl = $("#payTotal");
const payExpiryEl = $("#payExpiry");
const qrcodeImg = $("#qrcode");
const countdownEl = $("#countdown");
const cancelBtn = $("#cancelBtn");
const resultCard = $("#result");
const toastEl = $("#toast");

// modal2
const selectorModal = $("#selectorModal");
const priceModal = $("#priceModal");
const confirmCancelModal = $("#confirmCancel");
const historyModal = $("#historyModal"); // masih dipakai id-nya supaya nggak error

const paketListEl = $("#paketList");
const applyChoiceBtn = $("#applyChoice");
const clearChoiceBtn = $("#clearChoice");

const historyBtn = $("#historyBtn");
const historyListEl = $("#historyList");
const clearAllHistoryBtn = $("#clearAllHistory");

// AUDIO
const ding = $("#ding");

// STATE
let chosenPaket = null;
let pollTimer = null;
let countdownTimer = null;
let currentOrderId = null;

// DATA PAKET (SAMAKAN DENGAN SERVER)
const PAKET = [
  { key: "1gb", label: "1GB (Rp2.000)", harga: 2000 },
  { key: "2gb", label: "2GB (Rp3.000)", harga: 3000 },
  { key: "3gb", label: "3GB (Rp4.000)", harga: 4000 },
  { key: "4gb", label: "4GB (Rp5.000)", harga: 5000 },
  { key: "5gb", label: "5GB (Rp6.000)", harga: 6000 },
  { key: "6gb", label: "6GB (Rp7.000)", harga: 7000 },
  { key: "7gb", label: "7GB (Rp8.000)", harga: 8000 },
  { key: "8gb", label: "8GB (Rp9.000)", harga: 9000 },
  { key: "9gb", label: "9GB (Rp10.000)", harga: 10000 },
  { key: "10gb", label: "10GB (Rp12.000)", harga: 12000 },
  { key: "unli", label: "UNLI (Rp15.000)", harga: 15000 },
];

// =============== UTIL ===============

function showToast(msg, ms = 2500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function playDing() {
  if (!ding) return;
  ding.currentTime = 0;
  ding.play().catch(() => {});
}

function openModalSmooth(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("show"), 10);
}

function closeModalSmooth(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("show");
  setTimeout(() => el.classList.add("hidden"), 170);
}

// countdown timer
function startCountdown(expTs) {
  if (!countdownEl) return;
  if (countdownTimer) clearInterval(countdownTimer);

  function tick() {
    const left = expTs - Date.now();
    if (left <= 0) {
      countdownEl.textContent = "Kadaluarsa";
      clearInterval(countdownTimer);
      return;
    }
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    countdownEl.textContent = `Sisa ${mm}m ${ss}s`;
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

// polling status
async function getOrderStatus(id) {
  const res = await fetch(`/api/order/${id}/status`);
  return res.json();
}

function startPolling(orderId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const data = await getOrderStatus(orderId);
      if (!data) return;

      if (data.status === "success") {
        clearInterval(pollTimer);
        paymentCard.classList.add("hidden");
        showResult(data.result || {});
        playDing();
        showToast("Pembayaran berhasil! Panel dibuat.");
      } else if (data.status === "expired") {
        clearInterval(pollTimer);
        paymentCard.classList.add("hidden");
        showToast("Order kadaluarsa.");
        submitBtn.disabled = false;
      }
      // pending -> cuek
    } catch (e) {
      console.error("poll error", e);
    }
  }, 4000);
}

function showResult(result) {
  if (!resultCard) return;
  resultCard.classList.remove("hidden");

  const {
    login,
    username,
    password,
    phone,
    memory,
    cpu,
    dibuat,
    expired,
  } = result;

  resultCard.innerHTML = `
    <h2>Panel Siap 🎉</h2>
    <p><b>Nomor:</b> ${phone || "-"}</p>
    <p><b>Username Panel:</b> ${username || "-"}</p>
    <p><b>Password:</b> ${password || "-"}</p>
    <p><b>Login:</b> <a href="${login || "#"}" target="_blank">${login || "-"}</a></p>
    <p><b>RAM:</b> ${memory || "-"} MB • <b>CPU:</b> ${cpu || "-"}%</p>
    <p><b>Dibuat:</b> ${dibuat || "-"}</p>
    <p><b>Expired:</b> ${expired || "-"}</p>
  `;
  resultCard.scrollIntoView({ behavior: "smooth" });
}

// =============== RENDER PAKET LIST ===============

function renderPaketList() {
  if (!paketListEl) return;
  paketListEl.innerHTML = PAKET.map(
    (p) => `
    <label style="display:block;padding:10px;border-radius:8px;margin-bottom:8px;cursor:pointer;border:1px dashed var(--line);">
      <input type="radio" name="paket" value="${p.key}" style="margin-right:8px">
      ${p.label}
    </label>`
  ).join("");
}

// =============== EVENT ===============

document.addEventListener("DOMContentLoaded", () => {
  renderPaketList();

  // open modal pilih paket
  openSelectorBtn.addEventListener("click", () => {
    openModalSmooth("selectorModal");
  });

  // close modal pilih paket
  $("#closeModal").addEventListener("click", () =>
    closeModalSmooth("selectorModal")
  );
  // backdrop close
  $$("#selectorModal .modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", () => closeModalSmooth("selectorModal"))
  );

  // pilih paket (radio)
  paketListEl.addEventListener("change", () => {
    const r = paketListEl.querySelector('input[name="paket"]:checked');
    chosenPaket = r ? r.value : null;
    applyChoiceBtn.disabled = !chosenPaket;
  });

  // clear paket
  clearChoiceBtn.addEventListener("click", () => {
    chosenPaket = null;
    paketListEl
      .querySelectorAll('input[name="paket"]')
      .forEach((i) => (i.checked = false));
    applyChoiceBtn.disabled = true;
    chosenBox.classList.add("hidden");
    seePriceBtn.classList.add("hidden");
    submitBtn.disabled = true;
  });

  // apply paket
  applyChoiceBtn.addEventListener("click", () => {
    if (!chosenPaket) return;
    const p = PAKET.find((x) => x.key === chosenPaket);
    chosenBox.classList.remove("hidden");
    chosenBox.textContent = p ? p.label : chosenPaket;
    seePriceBtn.classList.remove("hidden");

    // enable submit kalau username+phone sudah terisi
    const uOK = usernameInput.value.trim().length >= 3;
    const phOK = /^[0-9]{8,15}$/.test(phoneInput.value.trim());
    submitBtn.disabled = !(uOK && phOK);
    closeModalSmooth("selectorModal");
  });

  // modal harga paket
  seePriceBtn.addEventListener("click", () => {
    if (!chosenPaket) return;
    const p = PAKET.find((x) => x.key === chosenPaket);
    const base = p ? p.harga : 0;

    const detail = document.getElementById("priceDetail");
    if (detail) {
      detail.innerHTML = `
        <p><b>Paket:</b> ${p ? p.label : chosenPaket}</p>
        <p><b>Harga paket:</b> Rp${fmtRp(base)}</p>
        <p style="margin-top:8px;"><i>Biaya admin/pajak tambahan dihitung oleh sistem pembayaran.</i></p>
      `;
    }
    openModalSmooth("priceModal");
  });

  $("#closePrice").addEventListener("click", () =>
    closeModalSmooth("priceModal")
  );
  $$("#priceModal .modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", () => closeModalSmooth("priceModal"))
  );

  // input username/phone -> enable/disable submit
  function updateSubmitState() {
    const uOK = usernameInput.value.trim().length >= 3;
    const phOK = /^[0-9]{8,15}$/.test(phoneInput.value.trim());
    submitBtn.disabled = !(uOK && phOK && chosenPaket);
  }

  usernameInput.addEventListener("input", updateSubmitState);
  phoneInput.addEventListener("input", updateSubmitState);

  // refresh input
  refreshFormBtn.addEventListener("click", () => {
    usernameInput.value = "";
    phoneInput.value = "";
    chosenPaket = null;
    chosenBox.classList.add("hidden");
    seePriceBtn.classList.add("hidden");
    submitBtn.disabled = true;
    showToast("Form direset.");
  });

  // cancel pembayaran
  cancelBtn.addEventListener("click", () => {
    openModalSmooth("confirmCancel");
  });

  $("#noCancel").addEventListener("click", () =>
    closeModalSmooth("confirmCancel")
  );
  $("#yesCancel").addEventListener("click", async () => {
    closeModalSmooth("confirmCancel");
    if (currentOrderId) {
      try {
        await fetch(`/api/order/${currentOrderId}`, { method: "DELETE" });
      } catch {}
    }
    currentOrderId = null;
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    paymentCard.classList.add("hidden");
    submitBtn.disabled = false;
    showToast("Pembayaran dibatalkan.");
  });

  // history modal (sementara cuma placeholder biar gak error)
  historyBtn.addEventListener("click", () => {
    if (historyListEl) {
      historyListEl.innerHTML =
        '<p class="muted">Fitur riwayat belum diaktifkan.</p>';
    }
    openModalSmooth("historyModal");
  });
  $("#closeHistory").addEventListener("click", () =>
    closeModalSmooth("historyModal")
  );
  $("#closeHistoryOk").addEventListener("click", () =>
    closeModalSmooth("historyModal")
  );
  clearAllHistoryBtn.addEventListener("click", () =>
    showToast("Belum ada riwayat untuk dihapus.")
  );

  // SUBMIT FORM
  $("#orderForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const username = usernameInput.value.trim();
    const phone = phoneInput.value.trim();

    if (!/^[a-zA-Z0-9]{3,15}$/.test(username)) {
      showToast("Username 3–15 huruf/angka tanpa spasi.");
      return;
    }
    if (!/^[0-9]{8,15}$/.test(phone)) {
      showToast("Nomor telepon 8–15 angka.");
      return;
    }
    if (!chosenPaket) {
      showToast("Pilih paket panel dulu.");
      return;
    }

    submitBtn.disabled = true;
    processingCard.classList.remove("hidden");
    paymentCard.classList.add("hidden");
    resultCard.classList.add("hidden");

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          phone,
          paket: chosenPaket,
        }),
      });

      const data = await res.json();
      processingCard.classList.add("hidden");

      if (!data.ok) {
        showToast(data.error || "Gagal membuat order.");
        submitBtn.disabled = false;
        return;
      }

      // tampilkan QRIS
      currentOrderId = data.orderId;
      paymentCard.classList.remove("hidden");
      payTotalEl.textContent = "Rp" + fmtRp(data.price || 0);
      payExpiryEl.textContent = new Date(
        data.expiredAt || Date.now()
      ).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      qrcodeImg.src = data.qr_png || "";

      startCountdown(Number(data.expiredAt) || Date.now() + 5 * 60 * 1000);
      startPolling(data.orderId);
      showToast("QRIS berhasil dibuat, silakan scan.");

    } catch (err) {
      console.error(err);
      processingCard.classList.add("hidden");
      submitBtn.disabled = false;
      showToast("Terjadi kesalahan jaringan.");
    }
  });
});

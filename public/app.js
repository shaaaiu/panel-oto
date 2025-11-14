/* ======================= */
/*   PANEL-OTO UPDATED JS  */
/* ======================= */

const orderForm = document.getElementById('orderForm');
const processing = document.getElementById('processing');
const payment = document.getElementById('payment');
const resultBox = document.getElementById('result');
const submitBtn = document.getElementById('submitBtn');
const historyBtn = document.getElementById('openHistory');
const historyModal = document.getElementById('historyModal');
const historyBody = document.getElementById('historyBody');
const closeHistory = document.getElementById('closeHistory');
const clearHistory = document.getElementById('clearHistory');
const payTotal = document.getElementById('payTotal');
const payExpiry = document.getElementById('payExpiry');
const qrImg = document.getElementById('qrcode');
const cancelBtn = document.getElementById('cancelBtn');
const ding = document.getElementById('ding');

let activeInvoice = null;

/* ———————————————— */
/*  LOCALSTORAGE HELPERS  */
/* ———————————————— */

function saveHistory(data) {
    let list = JSON.parse(localStorage.getItem('historyPanel') || "[]");
    list.push(data);
    localStorage.setItem("historyPanel", JSON.stringify(list));
}

function loadHistory() {
    return JSON.parse(localStorage.getItem("historyPanel") || "[]");
}

function renderHistory() {
    let list = loadHistory();

    if (list.length === 0) {
        historyBody.innerHTML = `<p class="muted">Belum ada riwayat pembelian.</p>`;
        return;
    }

    historyBody.innerHTML = list.map((x, i) => `
        <div class="history-item">
            <p><b>Username:</b> ${x.username}</p>
            <p><b>Password:</b> ${x.password}</p>
            <p><b>Login:</b> <a href="${x.login}" target="_blank">Klik di sini</a></p>
            <p><b>Expired:</b> ${x.expired}</p>
            <p><b>Paket:</b> ${x.paket}</p>
            <p><b>Dibuat:</b> ${x.dibuat}</p>
            <button data-del="${i}" class="danger small">Hapus</button>
        </div>
    `).join("");
}

/* ———————————————— */
/*   HISTORY BUTTON EVENT */
/* ———————————————— */

historyBtn.addEventListener("click", () => {
    renderHistory();
    historyModal.classList.remove("hidden");
});

closeHistory.addEventListener("click", () => {
    historyModal.classList.add("hidden");
});

clearHistory.addEventListener("click", () => {
    localStorage.removeItem("historyPanel");
    renderHistory();
});

historyBody.addEventListener("click", e => {
    if (e.target.dataset.del !== undefined) {
        let list = loadHistory();
        list.splice(Number(e.target.dataset.del), 1);
        localStorage.setItem("historyPanel", JSON.stringify(list));
        renderHistory();
    }
});

/* ———————————————— */
/*       ORDER LOGIC      */
/* ———————————————— */

orderForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = orderForm.username.value.trim();
    const chosen = JSON.parse(localStorage.getItem("chosenPaket") || "{}");

    if (!chosen.id) {
        alert("Pilih paket dulu!");
        return;
    }

    processing.classList.remove("hidden");
    submitBtn.disabled = true;

    const payload = {
        username,
        paket: chosen.id
    };

    let req = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    let res = await req.json();

    processing.classList.add("hidden");

    if (!res.success) {
        alert(res.msg);
        submitBtn.disabled = false;
        return;
    }

    /* — Set QRIS state — */
    activeInvoice = res.data;
    localStorage.setItem("activeInvoice", JSON.stringify(res.data));

    loadQRIS(res.data);
});

/* ———————————————— */
/*      LOAD QR CODE      */
/* ———————————————— */

function loadQRIS(data) {
    orderForm.classList.add("hidden");
    payment.classList.remove("hidden");

    payTotal.textContent = data.amount;
    payExpiry.textContent = data.expired;
    qrImg.src = data.qr;

    startCountdown(data.expired);
}

/* ———————————————— */
/*      COUNTDOWN EXP     */
/* ———————————————— */

let timer;

function startCountdown(exp) {
    clearInterval(timer);

    timer = setInterval(() => {
        let now = Math.floor(Date.now() / 1000);
        let diff = exp - now;
        if (diff <= 0) {
            clearInterval(timer);
            cancelPayment();
        }
        document.getElementById("countdown").textContent =
            `Sisa waktu: ${diff}s`;
    }, 1000);
}

/* ———————————————— */
/*      CANCEL PAYMENT    */
/* ———————————————— */

cancelBtn.addEventListener("click", cancelPayment);

function cancelPayment() {
    payment.classList.add("hidden");
    orderForm.classList.remove("hidden");
    submitBtn.disabled = false;

    localStorage.removeItem("activeInvoice");
}

/* ———————————————— */
/*  CHECK PAYMENT STATUS  */
/* ———————————————— */

setInterval(async () => {
    const inv = JSON.parse(localStorage.getItem("activeInvoice") || "null");
    if (!inv) return;

    let req = await fetch(`/api/check?id=${inv.id}`);
    let res = await req.json();

    if (res.status === "PAID") {
        ding.play();

        saveHistory({
            username: res.username,
            password: res.password,
            login: res.login_url,
            expired: res.expired,
            paket: res.paket,
            dibuat: new Date().toLocaleString()
        });

        localStorage.removeItem("activeInvoice");

        payment.classList.add("hidden");
        resultBox.classList.remove("hidden");

        resultBox.innerHTML = `
            <h2>Berhasil!</h2>
            <p>Username: <b>${res.username}</b></p>
            <p>Password: <b>${res.password}</b></p>
            <p><a href="${res.login_url}" target="_blank">Login Panel</a></p>
        `;
    }

}, 2000);

/* ———————————————— */
/*     RECOVER ON REFRESH */
/* ———————————————— */

window.onload = () => {
    const inv = JSON.parse(localStorage.getItem("activeInvoice") || "null");
    if (inv) loadQRIS(inv);
};

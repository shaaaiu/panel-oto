const $ = (s)=>document.querySelector(s);
const fmtRp = (n)=> new Intl.NumberFormat('id-ID').format(n);

let pollTimer = null;
let countdownTimer = null;
let chosen = { domain:null, paket:null };

const DOMAINS = [
  'ryuushop.web.id',
  'ryuuxiao.biz.id',
  'xiaopanel.biz.id',
  'xiaoshop.my.id',
  'xiaoprivate.biz.id',
  'xiao-panel-free.biz.id'
];

const PAKET = [
  { key:'1gb',  label:'1GB (Rp2.000)' },
  { key:'2gb',  label:'2GB (Rp3.000)' },
  { key:'3gb',  label:'3GB (Rp4.000)' },
  { key:'4gb',  label:'4GB (Rp5.000)' },
  { key:'5gb',  label:'5GB (Rp6.000)' },
  { key:'6gb',  label:'6GB (Rp7.000)' },
  { key:'7gb',  label:'7GB (Rp8.000)' },
  { key:'8gb',  label:'8GB (Rp9.000)' },
  { key:'9gb',  label:'9GB (Rp10.000)' },
  { key:'10gb', label:'10GB (Rp12.000)' },
  { key:'unli', label:'UNLI (Rp15.000)' }
];

// Build modal lists
function buildLists() {
  const dEl = $('#domainList');
  dEl.innerHTML = DOMAINS.map((d,i)=>`
    <label class="row"><input type="radio" name="domain" value="${d}"> ${d}</label>
  `).join('');

  const pEl = $('#paketList');
  pEl.innerHTML = PAKET.map(p=>`
    <label class="row"><input type="radio" name="paket" value="${p.key}"> ${p.label}</label>
  `).join('');
}
buildLists();

function openModal(){ $('#selectorModal').classList.remove('hidden'); }
function closeModal(){ $('#selectorModal').classList.add('hidden'); }

$('#openSelector').addEventListener('click', openModal);
$('#closeModal').addEventListener('click', closeModal);
$('.modal-backdrop').addEventListener('click', closeModal);

$('#clearChoice').addEventListener('click', ()=>{
  chosen = { domain:null, paket:null };
  document.querySelectorAll('#selectorModal input[type=radio]').forEach(r=> r.checked = false);
  $('#applyChoice').disabled = true;
});

// Enable save when both chosen
$('#selectorModal').addEventListener('change', ()=>{
  const domain = $('input[name=domain]:checked')?.value || null;
  const paket = $('input[name=paket]:checked')?.value || null;
  chosen = { domain, paket };
  $('#applyChoice').disabled = !(domain && paket);
});

$('#applyChoice').addEventListener('click', ()=>{
  // Show selected chips
  $('#chosenBox').classList.remove('hidden');
  $('#chosenBox').innerHTML = `
    <div class="chips">
      <span class="chip">${chosen.domain}</span>
      <span class="chip">${PAKET.find(p=>p.key===chosen.paket).label}</span>
    </div>
  `;
  $('#submitBtn').disabled = !(chosen.domain && chosen.paket);
  closeModal();
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

  const username = (new FormData(e.target)).get('username').trim();
  if (!username || !chosen.domain || !chosen.paket) {
    showToast('Lengkapi username, domain, dan paket.');
    return;
  }

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ username, paket: chosen.paket, domain: chosen.domain })
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
        // AUTO HIDE QRIS on success
        cleanupTimers();
        $('#cancelBtn').classList.add('hidden');
        $('#payment').classList.add('hidden');
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
    ${r.domain ? `<p><b>Domain:</b> ${r.domain}</p>` : ''}
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

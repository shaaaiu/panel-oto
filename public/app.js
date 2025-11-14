    const $=s=>document.querySelector(s);
const fmtRp=n=>new Intl.NumberFormat('id-ID').format(n);
let pollTimer=null,countdownTimer=null,chosenPaket=null;

// === Telegram Notification ===
const sendTelegram = async (msg) => {
  const BOT_TOKEN = '8148796549:AAGpElCrznavySJAwx2oImV5wdRR2qykE7s'; // Ganti jika perlu
  const CHAT_ID = '7058216834';
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Gagal kirim notifikasi Telegram:', err);
  }
};

// Theme toggle
const root=document.documentElement;
const saved=localStorage.getItem('theme'); if(saved) root.setAttribute('data-theme',saved);
$('#themeToggle').textContent=saved==='light'?'🌙':'☀️';
$('#themeToggle').addEventListener('click',()=>{const t=root.getAttribute('data-theme')==='light'?'dark':'light';root.setAttribute('data-theme',t);localStorage.setItem('theme',t);$('#themeToggle').textContent=t==='light'?'🌙':'☀️';});

// Paket list
const PAKET=[
  {key:'1gb',label:'1GB (Rp2.000)',harga:2000,cpu:30},
  {key:'2gb',label:'2GB (Rp3.000)',harga:3000,cpu:50},
  {key:'3gb',label:'3GB (Rp4.000)',harga:4000,cpu:75},
  {key:'4gb',label:'4GB (Rp5.000)',harga:5000,cpu:100},
  {key:'5gb',label:'5GB (Rp6.000)',harga:6000,cpu:130},
  {key:'6gb',label:'6GB (Rp7.000)',harga:7000,cpu:150},
  {key:'7gb',label:'7GB (Rp8.000)',harga:8000,cpu:175},
  {key:'8gb',label:'8GB (Rp9.000)',harga:9000,cpu:200},
  {key:'9gb',label:'9GB (Rp10.000)',harga:10000,cpu:225},
  {key:'10gb',label:'10GB (Rp12.000)',harga:12000,cpu:250},
  {key:'unli',label:'UNLI (Rp15.000)',harga:15000,cpu:500}
];

function openModal(){ 
  $('#selectorModal').classList.remove('hidden');
  if(chosenPaket){
    const el=document.querySelector(`#paketList input[value='${chosenPaket}']`);
    if(el){ el.checked=true; $('#applyChoice').disabled=false; }
  }
}
function closeModal(){ $('#selectorModal').classList.add('hidden'); }
$('#openSelector').addEventListener('click', openModal);
$('#closeModal').addEventListener('click', closeModal);
document.querySelectorAll('.modal-backdrop').forEach(b=>b.addEventListener('click',e=>{ const parent=b.parentElement; if(parent) parent.classList.add('hidden'); }));

$('#paketList').innerHTML=PAKET.map(p=>`<label><input type="radio" name="paket" value="${p.key}"> ${p.label}</label>`).join('');
$('#paketList').addEventListener('change',()=>{
  const current=document.querySelector('input[name=paket]:checked');
  chosenPaket=current?current.value:null;
  $('#applyChoice').disabled=!chosenPaket;
});
$('#clearChoice').addEventListener('click',()=>{
  chosenPaket=null; document.querySelectorAll('#paketList input').forEach(r=>r.checked=false); $('#applyChoice').disabled=true;
});
$('#applyChoice').addEventListener('click',()=>{
  const current=document.querySelector('input[name=paket]:checked'); chosenPaket=current?current.value:chosenPaket;
  if(!chosenPaket) return;
  const p=PAKET.find(x=>x.key===chosenPaket);
  $('#chosenBox').classList.remove('hidden'); $('#chosenBox').textContent=p.label;
  $('#submitBtn').disabled=false; $('#seePrice').classList.remove('hidden');
  closeModal(); showPricePopup();
});

// SFX
const playSound=(id)=>{ const el=$(id); if(el){ el.currentTime=0; el.play().catch(()=>{}); } };

// Price popup
function showPricePopup(){
  const p=PAKET.find(x=>x.key===chosenPaket); if(!p) return;
  $('#priceDetail').innerHTML=`<p><b>Harga:</b> Rp${fmtRp(p.harga)}</p><p><b>Paket:</b> ${p.key.toUpperCase()} / CPU ${p.cpu}%</p>`;
  playSound('#ding'); $('#priceModal').classList.remove('hidden');
}
$('#seePrice').addEventListener('click', showPricePopup);
$('#closePrice').addEventListener('click', ()=> $('#priceModal').classList.add('hidden'));

// Cancel payment confirm popup
$('#cancelBtn').addEventListener('click', ()=>{ playSound('#ding'); $('#confirmCancel').classList.remove('hidden'); });
$('#noCancel').addEventListener('click', ()=> $('#confirmCancel').classList.add('hidden'));
$('#yesCancel').addEventListener('click', async ()=>{
  $('#confirmCancel').classList.add('hidden');
  try{ if(window.currentOrderId){ await fetch(`/api/order/${window.currentOrderId}`,{method:'DELETE'}); } }catch{}
  if(pollTimer) clearInterval(pollTimer); if(countdownTimer) clearInterval(countdownTimer);
  window.currentOrderId=null;
  localStorage.removeItem('currentOrder'); // hapus state persistent
  $('#qrcode').src=''; $('#payment').classList.add('hidden');
  $('#submitBtn').disabled=false;
  showToast('Pembayaran dibatalkan.'); $('#orderForm').scrollIntoView({behavior:'smooth'});
});

// ------------------- Riwayat Pembelian (localStorage per device) -------------------
const HISTORY_KEY = 'orderHistory_v1';
function getHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }catch{return [];}
}
function saveHistoryItem(item){
  const arr = getHistory();
  arr.unshift(item); // newest first
  // keep only latest 200 to avoid overgrowth
  if(arr.length>200) arr.length = 200;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
}
function deleteHistoryIndex(i){
  const arr=getHistory(); arr.splice(i,1); localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); renderHistoryList();
}
function clearAllHistory(){
  localStorage.removeItem(HISTORY_KEY); renderHistoryList();
}
function renderHistoryList(){
  const container = $('#historyList');
  const arr = getHistory();
  if(arr.length===0){
    container.innerHTML = '<p class="muted">Belum ada riwayat pembelian di perangkat ini.</p>';
    return;
  }
  container.innerHTML = arr.map((it, idx)=>`
    <div style="padding:10px;border-bottom:1px solid var(--line);display:flex;gap:10px;justify-content:space-between;align-items:center">
      <div>
        <div><b>${it.username}</b> • ${it.paket?.toUpperCase()||'-'}</div>
        <div class="muted" style="font-size:13px">Dibuat: ${it.dibuat} • Expired: ${it.expired}</div>
        <div style="font-size:13px">Login: <a href="${it.login}" target="_blank">${it.login}</a></div>
      </div>
      <div style="text-align:right;min-width:130px">
        <div style="margin-bottom:8px"><button class="secondary" data-idx="${idx}" data-action="copy">Copy Login</button></div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="ghost" data-idx="${idx}" data-action="delete">Hapus</button>
        </div>
      </div>
    </div>
  `).join('');
  // attach handlers
  container.querySelectorAll('button[data-action]').forEach(btn=>{
    btn.addEventListener('click',(e)=>{
      const idx = Number(btn.getAttribute('data-idx'));
      const act = btn.getAttribute('data-action');
      const arr = getHistory();
      const item = arr[idx];
      if(act==='delete') deleteHistoryIndex(idx);
      if(act==='copy' && item){
        const text = `Login: ${item.login}\nUser: ${item.username}\nPass: ${item.password}`;
        navigator.clipboard?.writeText(text).then(()=> showToast('Login disalin ke clipboard'));
      }
    });
  });
}

// history modal handlers
$('#historyBtn').addEventListener('click', ()=> { $('#historyModal').classList.remove('hidden'); renderHistoryList(); });
$('#closeHistory').addEventListener('click', ()=> $('#historyModal').classList.add('hidden'));
$('#closeHistoryOk').addEventListener('click', ()=> $('#historyModal').classList.add('hidden'));
$('#clearAllHistory').addEventListener('click', ()=> { if(confirm('Hapus semua riwayat di perangkat ini?')) clearAllHistory(); });

// ------------------- End history -------------------

// Submit
$('#orderForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username=(new FormData(e.target)).get('username').trim();
  if(!username) return showToast('Isi username.');
  if(!chosenPaket) return showToast('Pilih paket.');

  // Check if there's already a pending order in localStorage
  const currentOrder = JSON.parse(localStorage.getItem('currentOrder') || 'null');
  if(currentOrder && currentOrder.orderId && (new Date(currentOrder.expiredAt)).getTime() > Date.now()){
    // Restore payment view
    restorePendingOrderState(currentOrder);
    return showToast('Masih ada order yang belum selesai. Lihat di halaman pembayaran.');
  }

  $('#processingText').textContent='🔄 Memproses... harap tunggu QRIS muncul.';
  $('#processing').classList.remove('hidden'); $('#submitBtn').disabled=true; $('#payment').classList.add('hidden'); $('#result').classList.add('hidden');
  try{
    const res=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,paket:chosenPaket})});
    const j=await res.json();
    if(!j.ok){ $('#processing').classList.add('hidden'); $('#submitBtn').disabled=false; return showToast(j.error||'Gagal membuat order'); }
    await sendTelegram(`🛒 Order baru dari <b>${username}</b>\nPaket: <b>${chosenPaket}</b>\nHarga: Rp${fmtRp(j.price)}`);
    
    // save persistent current order state to survive refresh
    const persistent = {
      orderId: j.orderId,
      price: j.price,
      expiredAt: j.expiredAt, // timestamp in ms or iso
      username,
      paket: chosenPaket,
      qr_png: j.qr_png || ''
    };
    localStorage.setItem('currentOrder', JSON.stringify(persistent));
    // set window var and UI
    window.currentOrderId = j.orderId;
    $('#processing').classList.add('hidden'); $('#payment').classList.remove('hidden');
    $('#payTotal').textContent='Rp'+fmtRp(j.price);
    $('#payExpiry').textContent=new Date(j.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src=j.qr_png||'';
    startCountdown(new Date(j.expiredAt).getTime());
    startPolling(j.orderId);
  }catch(err){ $('#processing').classList.add('hidden'); $('#submitBtn').disabled=false; showToast('Gagal membuat order (network).'); }
});

function startCountdown(exp){
  if(countdownTimer) clearInterval(countdownTimer);
  const tick=()=>{
    const left = exp - Date.now();
    if(left<=0){
      $('#countdown').textContent='Kadaluarsa';
      clearInterval(countdownTimer);
      localStorage.removeItem('currentOrder');
      $('#submitBtn').disabled=false;
    } else {
      $('#countdown').textContent='Sisa '+Math.floor(left/60000)+'m '+Math.floor((left%60000)/1000)+'s';
    }
  };
  tick();
  countdownTimer=setInterval(tick,1000);
}

function startPolling(id){
  if(pollTimer) clearInterval(pollTimer);
  window.currentOrderId=id;
  pollTimer=setInterval(async()=>{
    try{
      const r=await fetch(`/api/order/${id}/status`);
      const j=await r.json();
      if(j.status==='success'){
        clearInterval(pollTimer);
        $('#payment').classList.add('hidden');
        // show result and store history
        showResult(j.result);
        // prepare history item
        const p = PAKET.find(x=>x.key===chosenPaket) || {};
        saveHistoryItem({
          username: j.result.username || j.result.user || '',
          password: j.result.password || '',
          login: j.result.login || '#',
          expired: j.result.expired || (new Date(j.result.expiredAt || Date.now()).toLocaleString('id-ID')),
          memory: j.result.memory || j.result.ram || '',
          cpu: j.result.cpu || p.cpu || '',
          dibuat: j.result.dibuat || new Date().toLocaleString('id-ID'),
          paket: chosenPaket,
          waktu_order: new Date().toLocaleString('id-ID')
        });
        localStorage.removeItem('currentOrder'); // hapus state pending
        await sendTelegram(`✅ Pembayaran sukses!\nUser: <b>${j.result.username}</b>\nPaket: <b>${chosenPaket}</b>`);
        $('#submitBtn').disabled=false;
      } else if(j.status==='expired'){
        clearInterval(pollTimer);
        $('#payment').classList.add('hidden');
        localStorage.removeItem('currentOrder');
        showToast('Kadaluarsa');
        $('#submitBtn').disabled=false;
      }
    }catch(err){
      console.error('polling error',err);
    }
  },5000);
}

// Display result
function showResult(r){
  const el=$('#result'); el.classList.remove('hidden');
  // some fallback names
  const username = r.username || r.user || '';
  const password = r.password || r.pass || '';
  const login = r.login || r.panel_url || '#';
  const memory = r.memory || r.ram || '-';
  const cpu = r.cpu || '-';
  const dibuat = r.dibuat || new Date().toLocaleString('id-ID');
  const expired = r.expired || (new Date(r.expiredAt || Date.now()).toLocaleString('id-ID'));
  el.innerHTML=`<h2>Panel Siap 🎉</h2>
    <p><b>Login:</b> <a href="${login}" target="_blank">${login}</a></p>
    <p><b>Username:</b> ${username}</p>
    <p><b>Password:</b> ${password}</p>
    <p><b>RAM:</b> ${memory} MB • <b>CPU:</b> ${cpu}%</p>
    <p><b>Dibuat:</b> ${dibuat} WIB</p>
    <p><b>Expired:</b> ${expired}</p>`;
  window.scrollTo({top:el.offsetTop,behavior:'smooth'});
}

// Toast
function showToast(t){ const el=$('#toast'); el.textContent=t; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000); }

// restore pending state (called on load or when user tries to create while pending)
function restorePendingOrderState(state){
  if(!state) return;
  try{
    const exp = Number(state.expiredAt) || new Date(state.expiredAt).getTime();
    $('#payment').classList.remove('hidden');
    $('#payTotal').textContent='Rp'+fmtRp(state.price||0);
    $('#payExpiry').textContent=new Date(exp).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src=state.qr_png||'';
    window.currentOrderId = state.orderId;
    startCountdown(exp);
    startPolling(state.orderId);
    $('#submitBtn').disabled=true;
  }catch(err){ console.error('restore error', err); }
}

// On load: restore chosen paket, username, and pending order
window.addEventListener('DOMContentLoaded', ()=>{
  // restore chosen paket
  const savedP = localStorage.getItem('chosenPaket_v1');
  if(savedP){
    chosenPaket = savedP;
    const p = PAKET.find(x=>x.key===chosenPaket);
    if(p){ $('#chosenBox').classList.remove('hidden'); $('#chosenBox').textContent=p.label; $('#submitBtn').disabled=false; $('#seePrice').classList.remove('hidden'); }
  }
  // restore username
  const savedUser = localStorage.getItem('form_username_v1');
  if(savedUser) $('#usernameInput').value = savedUser;

  // bind input auto-save
  $('#usernameInput').addEventListener('input', (e)=> localStorage.setItem('form_username_v1', e.target.value));

  // restore pending order if any
  const currentOrder = JSON.parse(localStorage.getItem('currentOrder') || 'null');
  if(currentOrder && currentOrder.orderId){
    // if expired, cleanup
    const exp = Number(currentOrder.expiredAt) || new Date(currentOrder.expiredAt).getTime();
    if(exp > Date.now()){
      restorePendingOrderState(currentOrder);
      showToast('Memulihkan pesanan yang belum selesai...');
    } else {
      localStorage.removeItem('currentOrder');
    }
  }

  // restore chosen paket radio selection in selector modal
  if(chosenPaket){
    const radio = document.querySelector(`#paketList input[value='${chosenPaket}']`);
    if(radio) radio.checked = true;
  }
});

// persist chosen paket whenever apply clicked or selection change
document.addEventListener('change', (e)=>{
  if(e.target && e.target.name === 'paket'){
    localStorage.setItem('chosenPaket_v1', e.target.value);
  }
});
$('#applyChoice').addEventListener('click', ()=> {
  if(chosenPaket) localStorage.setItem('chosenPaket_v1', chosenPaket);
});

// beforeunload: do minimal save (already saved earlier), ensure no double submit
window.addEventListener('beforeunload', ()=>{
  // nothing heavy, state already persisted
});

// On page load, also render history list preemptively? no need until modal opened

// If user refreshes and had chosenPaket, keep it visible (we already did that above)

// Small UX: disable submit if username empty
$('#usernameInput').addEventListener('input', (e)=>{
  const v = e.target.value.trim();
  if(!v) $('#submitBtn').disabled = true;
  else if(chosenPaket) $('#submitBtn').disabled = false;
});

// Helper: if user manually clears qrcode or presses back, ensure state cleaned
// Keep code minimal for maintainability

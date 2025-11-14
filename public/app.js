const $=s=>document.querySelector(s);
const fmtRp=n=>new Intl.NumberFormat('id-ID').format(n);
let pollTimer=null,countdownTimer=null,chosenPaket=null;
let currentOrderData = JSON.parse(localStorage.getItem('currentOrderState') || 'null'); // Muat state dari localStorage

// === Telegram Notification ===
const sendTelegram = async (msg) => {
  const BOT_TOKEN = '8148796549:AAGpElCrznavySJAwx2oImV5wdRR2qykE7s'; 
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

// === State Persistence & Management ===
function saveOrderState(orderId, exp, qrPng, price, status='pending') {
    currentOrderData = { orderId, exp, qrPng, price, chosenPaket, status };
    localStorage.setItem('currentOrderState', JSON.stringify(currentOrderData));
}

function clearOrderState() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    currentOrderData = null;
    localStorage.removeItem('currentOrderState');
    
    // Reset UI
    $('#qrcode').src='';
    $('#payment').classList.add('hidden');
    $('#result').classList.add('hidden');
    $('#historyBtn').classList.add('hidden');
    $('#submitBtn').disabled = false;
    $('#openSelector').disabled = false;
    $('#orderForm').scrollIntoView({behavior:'smooth'});
}

async function loadOrderState() {
    // Jika tidak ada data atau status sudah selesai/expired, reset dan keluar
    if (!currentOrderData || currentOrderData.status === 'success' || currentOrderData.status === 'expired' || currentOrderData.status === 'cancelled') {
        clearOrderState();
        return;
    }
    
    // Jika ada order yang belum selesai (status pending)
    const { orderId, exp, qrPng, price, chosenPaket: savedPaket } = currentOrderData;
    
    window.currentOrderId = orderId;
    chosenPaket = savedPaket; // <-- Fix: Restore chosenPaket
    
    // Set form dan UI
    const p = PAKET.find(x => x.key === savedPaket);
    if (p) {
        $('#chosenBox').classList.remove('hidden'); 
        $('#chosenBox').textContent = p.label;
        $('#submitBtn').disabled = true; 
        $('#openSelector').disabled = true; // Kunci selector saat order aktif
        $('#seePrice').classList.remove('hidden'); // Tampilkan lihat harga
    }

    // Tampilkan tombol riwayat
    $('#historyBtn').classList.remove('hidden');
    
    // Langsung cek status terbaru
    const r = await fetch(`/api/order/${orderId}/status`);
    const j = await r.json();

    if (j.status === 'success') {
        showResult(j.result);
        saveOrderState(orderId, exp, qrPng, price, 'success');
        clearOrderState(); // Bersihkan UI/Logic setelah sukses
    } else if (j.status === 'expired' || Date.now() >= exp) {
        showToast('Pembayaran sebelumnya kadaluarsa.');
        clearOrderState(); 
    } else if (j.status === 'pending') {
        // Lanjutkan polling dan countdown
        $('#payment').classList.remove('hidden');
        $('#payTotal').textContent = 'Rp' + fmtRp(price);
        $('#payExpiry').textContent = new Date(exp).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
        $('#qrcode').src = qrPng;
        startCountdown(exp);
        startPolling(orderId);
        showToast('Status order dimuat ulang. Sisa waktu dilanjutkan.');
    } else {
        // Jika status lain (error/cancel dari server)
        clearOrderState();
    }
}

// Panggil saat DOM dimuat
window.addEventListener('load', loadOrderState);


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
  // Menampilkan harga dasar atau total harga dari state yang aktif
  const priceDisplay = currentOrderData && currentOrderData.status === 'pending'
    ? `<p><b>Total Bayar:</b> Rp${fmtRp(currentOrderData.price)}</p><p class="muted">Sudah termasuk biaya admin.</p>`
    : `<p><b>Harga Dasar:</b> Rp${fmtRp(p.harga)}</p><p class="muted">Biaya admin akan ditambahkan saat QRIS dibuat.</p>`;

  $('#priceDetail').innerHTML=`${priceDisplay}<p><b>Paket:</b> ${p.key.toUpperCase()} / CPU ${p.cpu}%</p>`;
  playSound('#ding'); $('#priceModal').classList.remove('hidden');
}
$('#seePrice').addEventListener('click', showPricePopup);
$('#closePrice').addEventListener('click', ()=> $('#priceModal').classList.add('hidden'));

// Cancel payment confirm popup
$('#cancelBtn').addEventListener('click', ()=>{ playSound('#ding'); $('#confirmCancel').classList.remove('hidden'); });
$('#noCancel').addEventListener('click', ()=> $('#confirmCancel').classList.add('hidden'));
$('#yesCancel').addEventListener('click', async ()=>{
  $('#confirmCancel').classList.add('hidden');
  try{ 
    if(window.currentOrderId){ 
      await fetch(`/api/order/${window.currentOrderId}`,{method:'DELETE'}); 
      showToast('Permintaan pembatalan dikirim ke server.');
    } 
  }catch{}
  
  clearOrderState(); // Bersihkan state lokal
  showToast('Pembayaran dibatalkan. Form siap digunakan.'); 
});

// Submit
$('#orderForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username=(new FormData(e.target)).get('username').trim();
  if(!username) return showToast('Isi username.');
  if(!chosenPaket) return showToast('Pilih paket.');
  
  // Disable form elements saat memproses
  $('#openSelector').disabled = true;
  $('#submitBtn').disabled = true;
  
  $('#processingText').textContent='🔄 Memproses... harap tunggu QRIS muncul.';
  $('#processing').classList.remove('hidden'); $('#payment').classList.add('hidden'); $('#result').classList.add('hidden');
  
  try{
    const res=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,paket:chosenPaket})});
    const j=await res.json();
    
    if(!j.ok){ 
        $('#processing').classList.add('hidden'); 
        $('#submitBtn').disabled=false; 
        $('#openSelector').disabled = false;
        return showToast(j.error||'Gagal membuat order'); 
    }
    
    await sendTelegram(`🛒 Order baru dari <b>${username}</b>\nPaket: <b>${chosenPaket}</b>\nHarga: Rp${fmtRp(j.price)}`);
    
    // Simpan state sebelum menampilkan pembayaran
    saveOrderState(j.orderId, j.expiredAt, j.qr_png, j.price, 'pending');

    $('#processing').classList.add('hidden'); 
    $('#payment').classList.remove('hidden');
    $('#historyBtn').classList.remove('hidden'); // Tampilkan tombol riwayat
    
    $('#payTotal').textContent='Rp'+fmtRp(j.price);
    $('#payExpiry').textContent=new Date(j.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src=j.qr_png||''; 
    startCountdown(j.expiredAt); 
    startPolling(j.orderId);
    $('#payment').scrollIntoView({behavior:'smooth'});
    
  }catch(err){ 
    $('#processing').classList.add('hidden'); 
    $('#submitBtn').disabled=false; 
    $('#openSelector').disabled = false;
    showToast('Gagal membuat order (network).'); 
  }
});

function startCountdown(exp){ 
    if(countdownTimer) clearInterval(countdownTimer);
    const tick=()=>{
        const left=exp-Date.now(); 
        if(left<=0){
            $('#countdown').textContent='Kadaluarsa'; 
            clearInterval(countdownTimer);
            // Panggil clear state jika kadaluarsa
            showToast('Pembayaran kadaluarsa.');
            clearOrderState(); 
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
        const r=await fetch(`/api/order/${id}/status`); 
        const j=await r.json(); 
        
        if(j.status==='success'){ 
            clearInterval(pollTimer); 
            $('#payment').classList.add('hidden'); 
            showResult(j.result); 
            saveOrderState(id, currentOrderData.exp, currentOrderData.qrPng, currentOrderData.price, 'success');
            clearOrderState(); // Setelah sukses, hapus dari pending
            await sendTelegram(`✅ Pembayaran sukses!\nUser: <b>${j.result.username}</b>\nPaket: <b>${currentOrderData.chosenPaket}</b>`);
        } else if(j.status==='expired' || j.status==='cancelled'){ 
            clearInterval(pollTimer); 
            $('#payment').classList.add('hidden'); 
            showToast(j.status === 'expired' ? 'Pembayaran Kadaluarsa' : 'Pembayaran Dibatalkan'); 
            clearOrderState(); 
        } 
    },5000); 
}

function showResult(r){ 
    const el=$('#result'); 
    el.classList.remove('hidden'); 
    el.innerHTML=`<h2>Panel Siap 🎉</h2><p><b>Login:</b> <a href='${r.login}' target='_blank'>${r.login}</a></p><p><b>Username:</b> ${r.username}</p><p><b>Password:</b> ${r.password}</p><p><b>RAM:</b> ${r.memory} MB • <b>CPU:</b> ${r.cpu}%</p><p><b>Dibuat:</b> ${r.dibuat} WIB<p><p><b>Expired:</b> ${r.expired}</p>`; 
    window.scrollTo({top:el.offsetTop,behavior:'smooth'}); 
}

function showToast(t){ 
    const el=$('#toast'); 
    el.textContent=t; 
    el.classList.remove('hidden'); 
    setTimeout(()=>el.classList.add('hidden'),3000); 
}

// History Button Handler
$('#historyBtn').addEventListener('click', () => {
    if (currentOrderData && currentOrderData.status === 'pending') {
        $('#payment').classList.remove('hidden');
        $('#payment').scrollIntoView({behavior:'smooth'});
        showToast("Melanjutkan pembayaran aktif.");
    } else {
        // Ini tidak seharusnya terjadi jika loadOrderState benar
        showToast("Tidak ada riwayat pembelian aktif yang belum selesai.");
        clearOrderState();
    }
});
    

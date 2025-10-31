const $=s=>document.querySelector(s);
const fmtRp=n=>new Intl.NumberFormat('id-ID').format(n);
let pollTimer=null,countdownTimer=null,chosenPaket=null;

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

// Build modal list
function openModal(){ $('#selectorModal').classList.remove('hidden'); }
function closeModal(){ $('#selectorModal').classList.add('hidden'); }
$('#openSelector').addEventListener('click', openModal);
$('#closeModal').addEventListener('click', closeModal);
$('.modal-backdrop').addEventListener('click', (e)=>{
  if(e.target.closest('.modal-card')) return;
  document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));
});

$('#paketList').innerHTML = PAKET.map(p=>`<label><input type="radio" name="paket" value="${p.key}"> ${p.label}</label>`).join('');
$('#paketList').addEventListener('change', ()=>{
  chosenPaket = $('input[name=paket]:checked')?.value;
  $('#applyChoice').disabled = !chosenPaket;
});
$('#clearChoice').addEventListener('click', ()=>{
  chosenPaket = null;
  document.querySelectorAll('#paketList input').forEach(r=>r.checked=false);
  $('#applyChoice').disabled = true;
});
$('#applyChoice').addEventListener('click', ()=>{
  const p = PAKET.find(x=>x.key===chosenPaket);
  $('#chosenBox').classList.remove('hidden');
  $('#chosenBox').textContent = p.label;
  $('#submitBtn').disabled = !chosenPaket;
  $('#seePrice').classList.remove('hidden');
  closeModal();
  showPricePopup(); // otomatis tampilkan popup harga sekali setelah pilih
});

// SFX
const playSound=(id)=>{ const el=$(id); if(el){ el.currentTime=0; el.play().catch(()=>{}); } };

// Price popup
function showPricePopup(){
  const p = PAKET.find(x=>x.key===chosenPaket); if(!p) return;
  $('#priceDetail').innerHTML = `<p><b>Harga:</b> Rp${fmtRp(p.harga)}</p><p><b>Paket:</b> ${p.key.toUpperCase()} / CPU ${p.cpu}%</p>`;
  playSound('#ding');
  $('#priceModal').classList.remove('hidden');
}
$('#seePrice').addEventListener('click', showPricePopup);
$('#closePrice').addEventListener('click', ()=> $('#priceModal').classList.add('hidden'));

// Cancel payment confirm popup
$('#cancelBtn').addEventListener('click', ()=>{
  playSound('#ding');
  $('#confirmCancel').classList.remove('hidden');
});
$('#noCancel').addEventListener('click', ()=> $('#confirmCancel').classList.add('hidden'));
$('#yesCancel').addEventListener('click', async ()=>{
  $('#confirmCancel').classList.add('hidden');
  if(window.currentOrderId){
    try{
      const r=await fetch(`/api/order/${window.currentOrderId}`,{method:'DELETE'});
      const j=await r.json();
      // regardless, reset UI:
    }catch{}
  }
  // reset timers & UI
  if(pollTimer) clearInterval(pollTimer);
  if(countdownTimer) clearInterval(countdownTimer);
  window.currentOrderId=null;
  $('#qrcode').src='';
  $('#payment').classList.add('hidden');
  showToast('Pembayaran dibatalkan.');
  $('#orderForm').scrollIntoView({behavior:'smooth'});
});

// Submit
$('#orderForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = (new FormData(e.target)).get('username').trim();
  if(!username || !chosenPaket) return showToast('Isi username & pilih paket.');
  $('#processing').classList.remove('hidden');
  $('#payment').classList.add('hidden'); $('#result').classList.add('hidden');
  try{
    const res = await fetch('/api/order', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, paket: chosenPaket})});
    const j = await res.json();
    $('#processing').classList.add('hidden');
    if(!j.ok) return showToast(j.error || 'Gagal membuat order');
    $('#payment').classList.remove('hidden');
    $('#payTotal').textContent = 'Rp' + fmtRp(j.price);
    $('#payExpiry').textContent = new Date(j.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    $('#qrcode').src = j.qr_png;
    startCountdown(j.expiredAt); startPolling(j.orderId);
  }catch(err){
    $('#processing').classList.add('hidden');
    showToast('Gagal membuat order.');
  }
});

function startCountdown(exp){ const tick=()=>{const left=exp-Date.now(); if(left<=0){$('#countdown').textContent='Kadaluarsa'; clearInterval(countdownTimer);} else {$('#countdown').textContent='Sisa '+Math.floor(left/60000)+'m '+Math.floor((left%60000)/1000)+'s';}}; tick(); countdownTimer=setInterval(tick,1000); }
function startPolling(id){ window.currentOrderId=id; pollTimer=setInterval(async()=>{ const r=await fetch(`/api/order/${id}/status`); const j=await r.json(); if(j.status==='success'){ clearInterval(pollTimer); $('#payment').classList.add('hidden'); showResult(j.result); } else if(j.status==='expired'){ clearInterval(pollTimer); $('#payment').classList.add('hidden'); showToast('Kadaluarsa'); } },5000); }
function showResult(r){ const el=$('#result'); el.classList.remove('hidden'); el.innerHTML = `<h2>Panel Siap 🎉</h2><p><b>Login:</b> <a href='${r.login}' target='_blank'>${r.login}</a></p><p><b>Username:</b> ${r.username}</p><p><b>Password:</b> ${r.password}</p><p><b>RAM:</b> ${r.memory} MB • <b>CPU:</b> ${r.cpu}%</p><p><b>Dibuat:</b> ${r.dibuat} WIB • <b>Expired:</b> ${r.expired}</p>`; window.scrollTo({top:el.offsetTop,behavior:'smooth'}); }
function showToast(t){ const el=$('#toast'); el.textContent=t; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000); }

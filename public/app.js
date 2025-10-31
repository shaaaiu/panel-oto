const $ = s => document.querySelector(s);
const fmtRp = n => new Intl.NumberFormat('id-ID').format(n);
let pollTimer=null, countdownTimer=null, chosenPaket=null;

// Theme toggle
const root=document.documentElement;
const savedTheme=localStorage.getItem('theme');
if(savedTheme)root.setAttribute('data-theme',savedTheme);
$('#themeToggle').textContent=savedTheme==='light'?'🌙':'☀️';
$('#themeToggle').addEventListener('click',()=>{
  const t=root.getAttribute('data-theme')==='light'?'dark':'light';
  root.setAttribute('data-theme',t);
  localStorage.setItem('theme',t);
  $('#themeToggle').textContent=t==='light'?'🌙':'☀️';
});

const PAKET=[
  {key:'1gb',label:'1GB (Rp2.000)'},{key:'2gb',label:'2GB (Rp3.000)'},{key:'3gb',label:'3GB (Rp4.000)'},{key:'4gb',label:'4GB (Rp5.000)'},{key:'5gb',label:'5GB (Rp6.000)'},{key:'6gb',label:'6GB (Rp7.000)'},{key:'7gb',label:'7GB (Rp8.000)'},{key:'8gb',label:'8GB (Rp9.000)'},{key:'9gb',label:'9GB (Rp10.000)'},{key:'10gb',label:'10GB (Rp12.000)'},{key:'unli',label:'UNLI (Rp15.000)'}
];

// Modal logic
function openModal(){ $('#selectorModal').classList.remove('hidden'); }
function closeModal(){ $('#selectorModal').classList.add('hidden'); }
$('#openSelector').addEventListener('click',openModal);
$('#closeModal').addEventListener('click',closeModal);
$('.modal-backdrop').addEventListener('click',closeModal);
$('#paketList').innerHTML=PAKET.map(p=>`<label><input type='radio' name='paket' value='${p.key}'> ${p.label}</label>`).join('');
$('#paketList').addEventListener('change',()=>{chosenPaket=$('input[name=paket]:checked')?.value;$('#applyChoice').disabled=!chosenPaket;});
$('#clearChoice').addEventListener('click',()=>{chosenPaket=null;document.querySelectorAll('#paketList input').forEach(r=>r.checked=false);$('#applyChoice').disabled=true;});
$('#applyChoice').addEventListener('click',()=>{const info=PAKET.find(p=>p.key===chosenPaket)?.label||'';$('#chosenBox').classList.remove('hidden');$('#chosenBox').innerHTML=`<div class='chips'><span class='chip'>${info}</span></div>`;$('#submitBtn').disabled=!chosenPaket;closeModal();});

$('#orderForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const username=(new FormData(e.target)).get('username').trim();
  if(!username||!chosenPaket)return showToast('Isi username & pilih paket.');
  $('#processing').classList.remove('hidden');
  $('#payment').classList.add('hidden');$('#result').classList.add('hidden');
  const res=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username, paket:chosenPaket})});
  const json=await res.json();
  $('#processing').classList.add('hidden');
  if(!json.ok)return showToast(json.error||'Gagal membuat order');
  $('#payment').classList.remove('hidden');
  $('#payTotal').textContent='Rp'+fmtRp(json.price);
  $('#payExpiry').textContent=new Date(json.expiredAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  $('#qrcode').src=json.qr_png;
  startCountdown(json.expiredAt);startPolling(json.orderId);
});

$('#cancelBtn').addEventListener('click',async()=>{
  if(!window.currentOrderId)return;
  if(!confirm('Batalkan pembayaran ini?'))return;
  const res=await fetch(`/api/order/${window.currentOrderId}`,{method:'DELETE'});
  const j=await res.json();
  if(j.ok){showToast('Pembayaran dibatalkan');$('#payment').classList.add('hidden');}
});

function startCountdown(exp){const tick=()=>{const left=exp-Date.now();if(left<=0){$('#countdown').textContent='Kadaluarsa';clearInterval(countdownTimer);}else{$('#countdown').textContent='Sisa '+Math.floor(left/60000)+'m '+Math.floor((left%60000)/1000)+'s';}};tick();countdownTimer=setInterval(tick,1000);}
function startPolling(id){window.currentOrderId=id;pollTimer=setInterval(async()=>{const r=await fetch(`/api/order/${id}/status`);const j=await r.json();if(j.status==='success'){clearInterval(pollTimer);$('#payment').classList.add('hidden');showResult(j.result);}else if(j.status==='expired'){clearInterval(pollTimer);$('#payment').classList.add('hidden');showToast('Kadaluarsa');}},5000);}
function showResult(r){const el=$('#result');el.classList.remove('hidden');el.innerHTML=`<h2>Panel Siap 🎉</h2><p><b>Login:</b> <a href='${r.login}' target='_blank'>${r.login}</a></p><p><b>Username:</b> ${r.username}</p><p><b>Password:</b> ${r.password}</p><p><b>RAM:</b> ${r.memory} MB • <b>CPU:</b> ${r.cpu}%</p><p><b>Dibuat:</b> ${r.dibuat} WIB • <b>Expired:</b> ${r.expired}</p>`;window.scrollTo({top:el.offsetTop,behavior:'smooth'});}
function showToast(t){const el=$('#toast');el.textContent=t;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),3000);}

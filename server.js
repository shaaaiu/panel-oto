import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import moment from 'moment-timezone';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Config (from .env) ---
const CONFIG = {
  // Ganti kunci API Atlantic dengan Requime
  REQUIME_API_KEY: process.env.REQUIME_API_KEY,
  // Tambahkan rate pajak (misal: 0.01 untuk 1%)
  TAX_RATE: parseFloat(process.env.TAX_RATE || '0.01'), 
  
  PTERO_DOMAIN: process.env.PTERO_DOMAIN,
  PTERO_APP_KEY: process.env.PTERO_APP_KEY,
  EGG_ID: parseInt(process.env.PTERO_EGG_ID || '15', 10),
  LOCATION_ID: parseInt(process.env.PTERO_LOCATION_ID || '1', 10),
  NEST_ID: parseInt(process.env.PTERO_NEST_ID || '5', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',
  PORT: parseInt(process.env.PORT || '3000', 10)
};

// --- Simple in-memory store (use DB for production) ---
const orders = new Map(); // id -> { ... }

// Paket mapping (Harga adalah harga dasar sebelum pajak)
const PAKET = {
  '1gb':  { harga: 2000,  memo: 1048,  cpu: 30  },
  '2gb':  { harga: 3000,  memo: 2048,  cpu: 50  },
  '3gb':  { harga: 4000,  memo: 3048,  cpu: 75  },
  '4gb':  { harga: 5000,  memo: 4048,  cpu: 100 },
  '5gb':  { harga: 6000,  memo: 5048,  cpu: 130 },
  '6gb':  { harga: 7000,  memo: 6048,  cpu: 150 },
  '7gb':  { harga: 8000,  memo: 7048,  cpu: 175 },
  '8gb':  { harga: 9000,  memo: 8048,  cpu: 200 },
  '9gb':  { harga: 10000, memo: 9048,  cpu: 225 },
  '10gb': { harga: 12000, memo: 10048, cpu: 250 },
  'unli': { harga: 15000, memo: 999999, cpu: 500 }
};

function isValidUsername(u) { return /^[a-zA-Z0-9]{3,15}$/.test(u); }
function expiryTimestamp(minutes=6) { return Date.now() + minutes*60*1000; }

// --- Helper API RequimeBoost ---

/**
 * Membuat QRIS via RequimeBoost
 * Menggunakan format JSON
 */
async function requimeCreateQRIS({ api_key, reff_id, nominal }) {
  const body = {
    api_key,
    reff_id,
    nominal: String(nominal),
    metode: 'qris'
  };
  const res = await fetch('https://requimeboost.id/api/h2h/deposit/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Requime create error HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success || !json.data) {
    throw new Error(`Requime create error: ${json.message || 'unknown'}`);
  }
  return json.data; // Mengembalikan { id, qr_content, expired, ... }
}

/**
 * Cek Status Deposit RequimeBoost
 * Menggunakan format JSON
 */
async function requimeCheckStatus({ api_key, id }) {
  const body = {
    api_key,
    id: String(id)
  };
  const res = await fetch('https://requimeboost.id/api/h2h/deposit/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Requime status error HTTP ${res.status}`);
  const json = await res.json();
  // Jika API call sukses tapi data tidak ada, anggap pending
  return json?.data?.status || 'pending';
}

/**
 * Batalkan Deposit RequimeBoost
 * Menggunakan format JSON
 */
async function requimeCancelDeposit({ api_key, id }) {
    const body = {
      api_key,
      id: String(id)
    };
    const res = await fetch('https://requimeboost.id/api/h2h/deposit/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    // Tidak melempar error jika gagal, cukup log di console
    if (!res.ok) {
        console.warn(`Requime cancel warning: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success) {
        console.warn(`Requime cancel warning: ${json.message || 'Failed to cancel'}`);
    }
    return json;
}

// --- Helper Pterodactyl (Tidak Berubah) ---

async function pteroCreateOrGetUser({ email, username, password }) {
  const createRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({ email, username, first_name: username, last_name: username, language: 'en', password })
  });
  const createJson = await createRes.json();
  if (createRes.ok && !createJson?.errors) return createJson.attributes;

  const listRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
    headers: { 'Accept':'application/json','Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  const listJson = await listRes.json();
  const user = listJson?.data?.[0]?.attributes;
  if (!user) {
    const msg = createJson?.errors?.[0]?.detail || 'failed to create/find user';
    throw new Error(`Pterodactyl user error: ${msg}`);
  }
  return user;
}

async function pteroGetEggStartup({ nestId, eggId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/nests/${nestId}/eggs/${eggId}`, {
    headers: { 'Accept':'application/json','Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  if (!res.ok) throw new Error(`Pterodactyl egg error HTTP ${res.status}`);
  const json = await res.json();
  return json?.attributes?.startup || 'npm start';
}

async function pteroCreateServer({ userId, name, memo, cpu, eggId, startup, locId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/servers`, {
    method: 'POST',
    headers: { 'Accept':'application/json','Content-Type':'application/json','Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` },
    body: JSON.stringify({
      name, description:' ', user:userId, egg:eggId, docker_image:'ghcr.io/parkervcp/yolks:nodejs_18',
      startup,
      environment:{ INST:'npm', USER_UPLOAD:'0', AUTO_UPDATE:'0', CMD_RUN:'npm start' },
      limits:{ memory:memo, swap:0, disk:0, io:500, cpu:cpu },
      feature_limits:{ databases:5, backups:5, allocations:1 },
      deploy:{ locations:[locId], dedicated_ip:false, port_range:[] }
    })
  });
  const json = await res.json();
  if (!res.ok || json?.errors) {
    const msg = json?.errors?.[0]?.detail || `HTTP ${res.status}`;
    throw new Error(`Pterodactyl server error: ${msg}`);
  }
  return json.attributes;
}

// --- API: Create order (username + paket + domain) ---
app.post('/api/order', async (req, res) => {
  try {
    const { username, paket, domain } = req.body || {};
    if (!isValidUsername(username)) return res.status(400).json({ ok:false, error:'Username 3–15 alfanumerik tanpa spasi' });

    const chosen = PAKET[String(paket).toLowerCase()];
    if (!chosen) return res.status(400).json({ ok:false, error:'Paket tidak dikenal' });

    const orderId = crypto.randomBytes(6).toString('hex').toUpperCase();
    const reffId = crypto.randomBytes(5).toString('hex').toUpperCase();
    
    // Hitung harga dasar, pajak, dan total
    const basePrice = chosen.harga;
    const tax = Math.floor(basePrice * CONFIG.TAX_RATE);
    const totalPrice = basePrice + tax;
    
    const expiredAt = expiryTimestamp(6); // 6 menit untuk order timeout

    // Panggil helper Requime
    const payData = await requimeCreateQRIS({ 
        api_key: CONFIG.REQUIME_API_KEY, 
        reff_id: reffId, 
        nominal: totalPrice // Kirim total harga (termasuk pajak)
    });
    
    // Gunakan qr_content dari Requime
    const qrPng = await QRCode.toDataURL(payData.qr_content, { margin: 2, scale: 8 });

    orders.set(orderId, {
      status: 'pending',
      username, paket: String(paket).toLowerCase(), domain: domain || null,
      basePrice, tax, totalPrice, // Simpan detail harga
      reffId, 
      paymentId: payData.id, // Ganti nama field
      qr_content: payData.qr_content, // Ganti nama field
      paymentExpiredAt: payData.expired, // Simpan waktu expired dari Requime
      createdAt: Date.now(), 
      expiredAt, // Waktu expired order internal
      processed: false, 
      result: null
    });

    return res.json({ 
        ok:true, 
        orderId, 
        price: totalPrice, // Kirim total harga ke user
        tax, // Kirim info pajak
        basePrice, // Kirim info harga dasar
        expiredAt, // Waktu expired order
        paymentExpiredAt: payData.expired, // Waktu expired QR
        qr_png: qrPng 
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message || 'server error' });
  }
});

// --- API: Get order status (poll) ---
app.get('/api/order/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);
    if (!order) return res.status(404).json({ ok:false, error:'Order not found' });

    // Cek jika order internal expired (belum dibayar dalam 6 menit)
    if (Date.now() >= order.expiredAt && order.status === 'pending') {
      order.status = 'expired';
    }

    if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });
    if (order.status === 'expired') return res.json({ ok:true, status:'expired' });
    if (order.status === 'cancelled') return res.json({ ok:true, status:'cancelled' });

    // Status masih 'pending', poll ke Requime
    const payStatus = await requimeCheckStatus({ 
        api_key: CONFIG.REQUIME_API_KEY, 
        id: order.paymentId // Gunakan paymentId
    });

    if (payStatus === 'success' && !order.processed) {
      order.processed = true;
      try {
        const email = `${order.username}@panel.com`;
        const password = `${order.username}001`;
        const name = `${order.username}${order.paket.toUpperCase()}`;
        const user = await pteroCreateOrGetUser({ email, username: order.username, password });
        const startup = await pteroGetEggStartup({ nestId: CONFIG.NEST_ID, eggId: CONFIG.EGG_ID });
        const chosen = PAKET[order.paket];
        const server = await pteroCreateServer({ userId: user.id, name, memo: chosen.memo, cpu: chosen.cpu, eggId: CONFIG.EGG_ID, startup, locId: CONFIG.LOCATION_ID });

        const waktuBuat = moment().tz(CONFIG.TIMEZONE).format('DD/MM/YYYY HH:mm');
        const waktuExpired = moment().add(30, 'days').tz(CONFIG.TIMEZONE).format('DD/MM/YYYY');

        order.status = 'success';
        order.result = {
          login: CONFIG.PTERO_DOMAIN,
          username: user.username,
          password,
          memory: server.limits?.memory ?? chosen.memo,
          cpu: server.limits?.cpu ?? chosen.cpu,
          dibuat: waktuBuat,
          expired: waktuExpired,
          domain: order.domain,
          // Tambahkan info tagihan
          tagihan: {
            paket: order.paket,
            harga_dasar: order.basePrice,
            pajak: order.tax,
            total: order.totalPrice
          }
        };
      } catch (err) {
        order.status = 'error';
        order.result = { error: err.message };
      }
    } else if (payStatus === 'expired') {
        order.status = 'expired';
    } else if (payStatus === 'cancel') {
        order.status = 'cancelled';
    }
    // Jika payStatus masih 'pending', biarkan status order tetap 'pending'

    if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });
    if (order.status === 'error') return res.json({ ok:false, status:'error', error: order.result?.error || 'processing error' });
    if (order.status === 'expired') return res.json({ ok:true, status:'expired' });
    if (order.status === 'cancelled') return res.json({ ok:true, status:'cancelled' });

    return res.json({ ok:true, status:'pending' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message || 'server error' });
  }
});

// --- API: Cancel order ---
app.delete('/api/order/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);
    if (!order) return res.status(404).json({ ok:false, error:'Order tidak ditemukan' });
    if (order.status !== 'pending') return res.status(400).json({ ok:false, error:'Order sudah diproses' });

    order.status = 'cancelled';

    // Panggil helper cancel Requime
    try {
      await requimeCancelDeposit({
          api_key: CONFIG.REQUIME_API_KEY,
          id: order.paymentId // Gunakan paymentId
      });
    } catch (e) {
      console.warn('Requime cancel gagal / tidak tersedia:', e.message);
    }

    return res.json({ ok:true, message:'Order dibatalkan.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message || 'server error' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok:true }));

app.listen(CONFIG.PORT, () => {
  console.log(`BuyPanel server (Requime Edition) running on :${CONFIG.PORT}`);
});

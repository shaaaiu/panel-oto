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
  ATLANTIC_API_KEY: process.env.ATLANTIC_API_KEY,
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

// Paket mapping
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

async function atlanticCreateQRIS({ api_key, reff_id, nominal }) {
  const body = new URLSearchParams();
  body.append('api_key', api_key);
  body.append('reff_id', reff_id);
  body.append('nominal', String(nominal));
  body.append('type', 'ewallet');
  body.append('metode', 'qrisfast');
  const res = await fetch('https://atlantich2h.com/deposit/create', { method:'POST', body });
  if (!res.ok) throw new Error(`Atlantic create error HTTP ${res.status}`);
  const json = await res.json();
  if (!json.status) throw new Error(`Atlantic create error: ${json.message || 'unknown'}`);
  return json.data;
}

async function atlanticCheckStatus({ api_key, id }) {
  const body = new URLSearchParams();
  body.append('api_key', api_key);
  body.append('id', String(id));
  const res = await fetch('https://atlantich2h.com/deposit/status', { method:'POST', body });
  if (!res.ok) throw new Error(`Atlantic status error HTTP ${res.status}`);
  const json = await res.json();
  return json?.data?.status || 'pending';
}

// Pterodactyl helpers
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
    const price = chosen.harga;
    const expiredAt = expiryTimestamp(6);

    const payData = await atlanticCreateQRIS({ api_key: CONFIG.ATLANTIC_API_KEY, reff_id: reffId, nominal: price });
    const qrPng = await QRCode.toDataURL(payData.qr_string, { margin: 2, scale: 8 });

    orders.set(orderId, {
      status: 'pending',
      username, paket: String(paket).toLowerCase(), domain: domain || null,
      price, reffId, atlanticId: payData.id, qr_string: payData.qr_string,
      createdAt: Date.now(), expiredAt, processed: false, result: null
    });

    return res.json({ ok:true, orderId, price, expiredAt, qr_png: qrPng });
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

    if (Date.now() >= order.expiredAt && order.status === 'pending') {
      order.status = 'expired';
      return res.json({ ok:true, status:'expired' });
    }

    if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });
    if (order.status === 'expired') return res.json({ ok:true, status:'expired' });
    if (order.status === 'cancelled') return res.json({ ok:true, status:'cancelled' });

    // Pending → poll payment
    const payStatus = await atlanticCheckStatus({ api_key: CONFIG.ATLANTIC_API_KEY, id: order.atlanticId });
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
          domain: order.domain
        };
      } catch (err) {
        order.status = 'error';
        order.result = { error: err.message };
      }
    }

    if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });
    if (order.status === 'error') return res.json({ ok:false, status:'error', error: order.result?.error || 'processing error' });

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

    try {
      const body = new URLSearchParams();
      body.append('api_key', CONFIG.ATLANTIC_API_KEY);
      body.append('id', String(order.atlanticId));
      await fetch('https://atlantich2h.com/deposit/cancel', { method: 'POST', body });
    } catch (e) {
      console.warn('Atlantic cancel gagal / tidak tersedia:', e.message);
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
  console.log(`BuyPanel server running on :${CONFIG.PORT}`);
});

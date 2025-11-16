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

// CONFIG
const CONFIG = {
  REQUIME_API_KEY: process.env.REQUIME_API_KEY,
  PTERO_DOMAIN: process.env.PTERO_DOMAIN,
  PTERO_APP_KEY: process.env.PTERO_APP_KEY,
  EGG_ID: parseInt(process.env.PTERO_EGG_ID || '15', 10),
  LOCATION_ID: parseInt(process.env.PTERO_LOCATION_ID || '1', 10),
  NEST_ID: parseInt(process.env.PTERO_NEST_ID || '5', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',
  PORT: parseInt(process.env.PORT || '3000', 10)
};

// DATA ORDER
const orders = new Map();

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

// =========================
// REQUIME BOOST API
// =========================
async function requimeCreateQRIS({ api_key, reff_id, basePrice }) {
  const body = {
    nominal: String(basePrice),
    method: 'QRISFAST',
    fee_by_customer: 'false',
    reff_id,
    api_key,
  };

  const res = await fetch('https://requimeboost.id/api/h2h/deposit/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });

  const rawText = await res.text();
  const json = JSON.parse(rawText);

  if (json.status !== 'success') {
    throw new Error(json.message || 'Requime error');
  }

  const data = json.data;

  return {
    id: data.id,
    qr_content: data.qr_image_string,
    expired: data.expired_at,
    total_nominal: data.nominal + data.fee,
    fee: data.fee
  };
}

async function requimeCheckStatus({ api_key, id }) {
  const res = await fetch('https://requimeboost.id/api/h2h/deposit/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ api_key, id: String(id) })
  });
  const j = await res.json();
  return j?.data?.status || 'pending';
}

async function requimeCancelDeposit({ api_key, id }) {
  await fetch('https://requimeboost.id/api/h2h/deposit/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ api_key, id: String(id) })
  });
}

// =========================
// PTERODACTYL API
// =========================

async function pteroCreateOrGetUser({ email, username, password }) {
  const createRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      email, username,
      first_name: username,
      last_name: username,
      language: 'en',
      password
    })
  });

  const json = await createRes.json();

  if (createRes.ok && !json?.errors) return json.attributes;

  const listRes = await fetch(
    `${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${encodeURIComponent(email)}`,
    { headers: { Accept:'application/json', Authorization:`Bearer ${CONFIG.PTERO_APP_KEY}` } }
  );

  const listJson = await listRes.json();
  return listJson?.data?.[0]?.attributes;
}

async function pteroGetEggStartup({ nestId, eggId }) {
  const res = await fetch(
    `${CONFIG.PTERO_DOMAIN}/api/application/nests/${nestId}/eggs/${eggId}`,
    { headers: { Accept:'application/json', Authorization:`Bearer ${CONFIG.PTERO_APP_KEY}` } }
  );
  const json = await res.json();
  return json?.attributes?.startup || "npm start";
}

async function pteroCreateServer({ userId, name, memo, cpu, eggId, startup, locId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/servers`, {
    method: 'POST',
    headers: {
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      name, description:' ',
      user: userId,
      egg: eggId,
      docker_image:'ghcr.io/parkervcp/yolks:nodejs_18',
      startup,
      environment: { INST:'npm', USER_UPLOAD:'0', AUTO_UPDATE:'0', CMD_RUN:'npm start' },
      limits:{ memory:memo, swap:0, disk:0, io:500, cpu },
      feature_limits:{ databases:5, backups:5, allocations:1 },
      deploy:{ locations:[locId], dedicated_ip:false, port_range:[] }
    })
  });

  const json = await res.json();
  return json.attributes;
}

// =========================
// API: CREATE ORDER
// =========================
app.post('/api/order', async (req, res) => {
  try {
    const { username, paket, domain, phone } = req.body || {};

    if (!isValidUsername(username))
      return res.status(400).json({ ok:false, error:'Username tidak valid' });

    if (!phone || !/^[0-9]{8,15}$/.test(phone))
      return res.status(400).json({ ok:false, error:'Nomor telepon tidak valid' });

    const chosen = PAKET[paket];
    if (!chosen)
      return res.status(400).json({ ok:false, error:'Paket tidak ada' });

    const orderId = crypto.randomBytes(6).toString('hex').toUpperCase();
    const reffId = crypto.randomBytes(5).toString('hex').toUpperCase();

    const basePrice = chosen.harga;
    const payData = await requimeCreateQRIS({
      api_key: CONFIG.REQUIME_API_KEY,
      reff_id: reffId,
      basePrice
    });

    const qrPng = await QRCode.toDataURL(payData.qr_content);

    orders.set(orderId, {
      status: 'pending',
      username,
      phone,
      paket,
      domain,
      basePrice,
      tax: payData.fee,
      totalPrice: payData.total_nominal,
      reffId,
      paymentId: payData.id,
      qr_content: payData.qr_content,
      createdAt: Date.now(),
      expiredAt: expiryTimestamp(6)
    });

    return res.json({
      ok: true,
      orderId,
      price: payData.total_nominal,
      expiredAt: Date.now() + 5*60*1000,
      qr_png: qrPng
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
});

// =========================
// API: CHECK STATUS
// =========================
app.get('/api/order/:id/status', async (req, res) => {
  try {
    const order = orders.get(req.params.id);
    if (!order) return res.json({ ok:false, status:'not_found' });

    const status = await requimeCheckStatus({
      api_key: CONFIG.REQUIME_API_KEY,
      id: order.paymentId
    });

    if (status === 'success' && !order.processed) {
      order.processed = true;

      const email = `${order.username}@panel.com`;
      const password = `${order.username}001`;

      const user = await pteroCreateOrGetUser({
        email, username: order.username, password
      });

      const startup = await pteroGetEggStartup({
        nestId: CONFIG.NEST_ID,
        eggId: CONFIG.EGG_ID
      });

      const dataPaket = PAKET[order.paket];

      const server = await pteroCreateServer({
        userId: user.id,
        name: `${order.username}${order.paket.toUpperCase()}`,
        memo: dataPaket.memo,
        cpu: dataPaket.cpu,
        eggId: CONFIG.EGG_ID,
        startup,
        locId: CONFIG.LOCATION_ID
      });

      order.status = 'success';
      order.result = {
        login: CONFIG.PTERO_DOMAIN,
        username: user.username,
        password,
        phone: order.phone,
        memory: server.limits.memory,
        cpu: server.limits.cpu,
        dibuat: moment().tz(CONFIG.TIMEZONE).format('DD/MM/YYYY HH:mm'),
        expired: moment().add(30, 'days').tz(CONFIG.TIMEZONE).format('DD/MM/YYYY'),
      };
    }

    return res.json({ ok:true, status: order.status, result: order.result });

  } catch (e) {
    return res.json({ ok:false, error:e.message });
  }
});

// =========================
// CANCEL ORDER
// =========================
app.delete('/api/order/:id', async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.json({ ok:false, error:'Order tidak ditemukan' });

  order.status = 'cancelled';

  await requimeCancelDeposit({
    api_key: CONFIG.REQUIME_API_KEY,
    id: order.paymentId
  });

  return res.json({ ok:true, message:'Order dibatalkan' });
});

app.listen(CONFIG.PORT, () => {
  console.log("Server berjalan pada port", CONFIG.PORT);
});

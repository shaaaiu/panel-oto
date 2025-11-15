import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import moment from 'moment-timezone';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIG .env UNTUK ORKUT & PTERO ---
const CONFIG = {
  ORKUT_APIKEY: process.env.ORKUT_APIKEY,
  ORKUT_USERNAME: process.env.ORKUT_USERNAME,
  ORKUT_TOKEN: process.env.ORKUT_TOKEN,

  PTERO_DOMAIN: process.env.PTERO_DOMAIN,
  PTERO_APP_KEY: process.env.PTERO_APP_KEY,
  EGG_ID: parseInt(process.env.PTERO_EGG_ID || '15'),
  LOCATION_ID: parseInt(process.env.PTERO_LOCATION_ID || '1'),
  NEST_ID: parseInt(process.env.PTERO_NEST_ID || '5'),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',
  PORT: parseInt(process.env.PORT || '3000')
};

const orders = new Map();

// Paket
const PAKET = {
  '500mb':  { harga: 500,  memo: 524,  cpu: 10  },
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

function isValidUsername(u) {
  return /^[a-zA-Z0-9]{3,15}$/.test(u);
}
function expiryTimestamp(min = 6) {
  return Date.now() + (min * 60 * 1000);
}


// =============================================================
// ORKUT QRIS - CREATE PAYMENT
// =============================================================
async function orkutCreateQRIS(amount) {
  const url =
    `https://apii.ryuuxiao.biz.id/orderkuota/createpayment?apikey=${CONFIG.ORKUT_APIKEY}`
    + `&username=${CONFIG.ORKUT_USERNAME}`
    + `&token=${CONFIG.ORKUT_TOKEN}`
    + `&amount=${amount}`;

  const res = await axios.get(url);
  if (!res.data?.status) throw new Error(res.data?.message || "Gagal membuat QRIS");

  return {
    qr_link: res.data.result.imageqris.url
  };
}


// =============================================================
// ORKUT QRIS - CHECK MUTASI
// =============================================================
async function orkutCheckMutasi(amount) {
  const url =
    `https://apii.ryuuxiao.biz.id/orderkuota/mutasiqr?apikey=${CONFIG.ORKUT_APIKEY}`
    + `&username=${CONFIG.ORKUT_USERNAME}`
    + `&token=${CONFIG.ORKUT_TOKEN}`;

  const res = await axios.get(url);
  const list = res.data?.result || [];

  return list.some(i =>
    i.status === "IN" &&
    parseInt(i.kredit.replace(/\./g, "")) === amount
  );
}


// =============================================================
// PTERO USER & SERVER (TIDAK BERUBAH)
// =============================================================
async function pteroCreateOrGetUser({ email, username, password }) {
  const createRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({ email, username, first_name: username, last_name: username, language:'en', password })
  });

  const data = await createRes.json();
  if (createRes.ok && !data?.errors) return data.attributes;

  const list = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${encodeURIComponent(email)}`,
    { headers: { 'Accept':'application/json', 'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }});

  const json = await list.json();
  const user = json?.data?.[0]?.attributes;
  if (!user) throw new Error('User gagal dibuat/ditemukan');

  return user;
}

async function pteroGetEggStartup({ nestId, eggId }) {
  const r = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/nests/${nestId}/eggs/${eggId}`, {
    headers: { 'Accept':'application/json', 'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  const j = await r.json();
  return j?.attributes?.startup || 'npm start';
}

async function pteroCreateServer({ userId, name, memo, cpu, eggId, startup, locId }) {
  const r = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/servers`, {
    method:'POST',
    headers: {
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      name,
      description:' ',
      user:userId,
      egg:eggId,
      docker_image:'ghcr.io/parkervcp/yolks:nodejs_18',
      startup,
      environment:{ INST:'npm', USER_UPLOAD:'0', AUTO_UPDATE:'0', CMD_RUN:'npm start' },
      limits:{ memory:memo, swap:0, disk:0, io:500, cpu:cpu },
      feature_limits:{ databases:5, backups:5, allocations:1 },
      deploy:{ locations:[locId], dedicated_ip:false, port_range:[] }
    })
  });

  const json = await r.json();
  if (!r.ok || json?.errors) throw new Error(json?.errors?.[0]?.detail || 'Gagal membuat server');
  return json.attributes;
}


// =============================================================
// CREATE ORDER — QRIS ORKUT
// =============================================================
app.post('/api/order', async (req, res) => {
  try {
    const { username, paket, domain } = req.body;
    if (!isValidUsername(username)) return res.json({ ok:false, error:'Username tidak valid' });

    const chosen = PAKET[paket];
    if (!chosen) return res.json({ ok:false, error:'Paket tidak ditemukan' });

    const orderId = crypto.randomBytes(6).toString("hex").toUpperCase();
    const totalPrice = chosen.harga;
    const expiredAt = expiryTimestamp(6);

    const pay = await orkutCreateQRIS(totalPrice);
    const qrPng = await QRCode.toDataURL(pay.qr_link);

    orders.set(orderId, {
      status:'pending',
      username,
      paket,
      domain: domain || null,
      totalPrice,
      qr_link: pay.qr_link,
      expiredAt,
      processed:false,
      createdAt: Date.now()
    });

    res.json({
      ok:true,
      orderId,
      price: totalPrice,
      expiredAt,
      qr_png: qrPng
    });

  } catch (e) {
    res.json({ ok:false, error:e.message });
  }
});


// =============================================================
// CEK ORDER — STATUS QRIS ORKUT
// =============================================================
app.get('/api/order/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);
    if (!order) return res.json({ ok:false, error:'Order tidak ditemukan' });

    if (Date.now() >= order.expiredAt && order.status === 'pending') {
      order.status = 'expired';
      return res.json({ ok:true, status:'expired' });
    }

    if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });
    if (order.status !== 'pending') return res.json({ ok:true, status: order.status });

    const paid = await orkutCheckMutasi(order.totalPrice);
    if (!paid) return res.json({ ok:true, status:'pending' });

    // Jika Lunas → buat server Ptero
    order.processed = true;
    try {
      const email = `${order.username}@panel.com`;
      const password = `${order.username}001`;
      const name = `${order.username}${order.paket.toUpperCase()}`;

      const user = await pteroCreateOrGetUser({ email, username: order.username, password });
      const chosen = PAKET[order.paket];
      const startup = await pteroGetEggStartup({ nestId: CONFIG.NEST_ID, eggId: CONFIG.EGG_ID });

      const srv = await pteroCreateServer({
        userId: user.id,
        name,
        memo: chosen.memo,
        cpu: chosen.cpu,
        eggId: CONFIG.EGG_ID,
        startup,
        locId: CONFIG.LOCATION_ID
      });

      const dibuat = moment().tz(CONFIG.TIMEZONE).format("DD/MM/YYYY HH:mm");
      const expired = moment().add(30,'days').tz(CONFIG.TIMEZONE).format("DD/MM/YYYY");

      order.status = 'success';
      order.result = {
        login: CONFIG.PTERO_DOMAIN,
        username: user.username,
        password,
        memory: srv.limits.memory,
        cpu: srv.limits.cpu,
        dibuat,
        expired,
        domain: order.domain,
        tagihan: {
          paket: order.paket,
          total: order.totalPrice
        }
      };

      return res.json({ ok:true, status:'success', result: order.result });

    } catch (err) {
      order.status = 'error';
      return res.json({ ok:false, status:'error', error: err.message });
    }

  } catch (e) {
    return res.json({ ok:false, error:e.message });
  }
});


// =============================================================
// CANCEL ORDER (Local only)
// =============================================================
app.delete('/api/order/:id', async (req, res) => {
  const id = req.params.id;
  const order = orders.get(id);
  if (!order) return res.json({ ok:false, error:'Order tidak ditemukan' });

  if (order.status !== 'pending') return res.json({ ok:false, error:'Order sudah diproses' });

  order.status = 'cancelled';
  return res.json({ ok:true, message:'Order dibatalkan.' });
});


// =============================================================
app.get('/health', (req, res) => res.json({ ok:true }));

app.listen(CONFIG.PORT, () => {
  console.log(`BuyPanel server (ORKUT QRIS Edition) running on :${CONFIG.PORT}`);
});

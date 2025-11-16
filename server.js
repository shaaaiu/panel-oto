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
  REQUIME_API_KEY: process.env.REQUIME_API_KEY,
  // TAX_RATE tidak digunakan lagi, fee dihitung oleh Requime

  PTERO_DOMAIN: process.env.PTERO_DOMAIN,
  PTERO_APP_KEY: process.env.PTERO_APP_KEY,
  EGG_ID: parseInt(process.env.PTERO_EGG_ID || '15', 10),
  LOCATION_ID: parseInt(process.env.PTERO_LOCATION_ID || '1', 10),
  NEST_ID: parseInt(process.env.PTERO_NEST_ID || '5', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',
  PORT: parseInt(process.env.PORT || '3000', 10)
};

// ====================== TELEGRAM NOTIFY ========================
const TG_TOKEN = '8105677831:AAFRyE6rRbIi3E9riMBIkaSA0Ya_lfT9tWg';
const TG_CHAT = '5254873680';

async function telegramNotify(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}

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
function expiryTimestamp(minutes = 6) { return Date.now() + minutes * 60 * 1000; }

// --- Helper API RequimeBoost (Diperbarui) ---

/**
 * Membuat QRIS via RequimeBoost
 * Menggunakan format payload dan cek status yang sesuai dengan cURL/screenshot.
 */
async function requimeCreateQRIS({ api_key, reff_id, basePrice }) {
  const body = {
    nominal: String(basePrice),          // Mengirim harga dasar
    method: 'QRISFAST',                  // Sesuai contoh cURL
    fee_by_customer: 'false',            // Fee ditanggung owner
    reff_id,
    api_key
  };

  console.log('[REQUIME CREATE REQUEST BODY]', body);

  const res = await fetch('https://requimeboost.id/api/h2h/deposit/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });

  const rawText = await res.text();
  console.log('[REQUIME CREATE RAW RESPONSE]', rawText);

  if (!res.ok) throw new Error(`Requime create error HTTP ${res.status}`);

  try {
    const json = JSON.parse(rawText);

    // Cek 'status' === 'success' (berdasarkan screenshot)
    if (json.status !== 'success' || !json.data) {
      throw new Error(`Requime create error: ${json.message || 'unknown'}`);
    }

    const data = json.data;

    return {
      id: data.id,
      qr_content: data.qr_image_string,          // QR string
      expired: data.expired_at,                  // expired_at
      total_nominal: data.nominal + data.fee,    // Nominal + Fee = Total Bayar
      fee: data.fee
    };
  } catch (e) {
    throw new Error(`Requime API response parsing failed: ${e.message}. Raw: ${rawText}`);
  }
}

/**
 * Cek Status Deposit RequimeBoost
 * Menggunakan format JSON
 */
async function requimeCheckStatus({ api_key, id }) {
  const body = { api_key, id: String(id) };
  const res = await fetch('https://requimeboost.id/api/h2h/deposit/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Requime status error HTTP ${res.status}`);
  const json = await res.json();
  // Status pembayaran ada di json.data.status (pending, success, expired, cancel)
  return json?.data?.status || 'pending';
}

/**
 * Batalkan Deposit RequimeBoost
 * Menggunakan format JSON
 */
async function requimeCancelDeposit({ api_key, id }) {
  const body = { api_key, id: String(id) };
  const res = await fetch('https://requimeboost.id/api/h2h/deposit/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    console.warn(`Requime cancel warning: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.status !== 'success') {
    console.warn(`Requime cancel warning: ${json.message || 'Failed to cancel'}`);
  }
  return json;
}

// --- Helper Pterodactyl ---

async function pteroCreateOrGetUser({ email, username, password }) {
  const createRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      email,
      username,
      first_name: username,
      last_name: username,
      language: 'en',
      password
    })
  });
  const createJson = await createRes.json();
  if (createRes.ok && !createJson?.errors) return createJson.attributes;

  const listRes = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }
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
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  if (!res.ok) throw new Error(`Pterodactyl egg error HTTP ${res.status}`);
  const json = await res.json();
  return json?.attributes?.startup || 'npm start';
}

async function pteroCreateServer({ userId, name, memo, cpu, eggId, startup, locId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/servers`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      name,
      description: ' ',
      user: userId,
      egg: eggId,
      docker_image: 'ghcr.io/parkervcp/yolks:nodejs_18',
      startup,
      environment: { INST: 'npm', USER_UPLOAD: '0', AUTO_UPDATE: '0', CMD_RUN: 'npm start' },
      limits: { memory: memo, swap: 0, disk: 0, io: 500, cpu },
      feature_limits: { databases: 5, backups: 5, allocations: 1 },
      deploy: { locations: [locId], dedicated_ip: false, port_range: [] }
    })
  });
  const json = await res.json();
  if (!res.ok || json?.errors) {
    const msg = json?.errors?.[0]?.detail || `HTTP ${res.status}`;
    throw new Error(`Pterodactyl server error: ${msg}`);
  }
  return json.attributes;
}

// --- API: Create order (username + paket + phone + domain opsional) ---
app.post('/api/order', async (req, res) => {
  try {
    if (!CONFIG.REQUIME_API_KEY) {
      return res.status(500).json({ ok: false, error: 'REQUIME_API_KEY tidak dikonfigurasi di .env' });
    }

    const { username, paket, domain, phone } = req.body || {};

    if (!isValidUsername(username)) {
      return res.status(400).json({ ok: false, error: 'Username 3–15 alfanumerik tanpa spasi' });
    }

    if (!phone || !/^[0-9]{8,15}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: 'Nomor telepon tidak valid (8–15 angka)' });
    }

    const chosen = PAKET[String(paket).toLowerCase()];
    if (!chosen) return res.status(400).json({ ok: false, error: 'Paket tidak dikenal' });

    const orderId = crypto.randomBytes(6).toString('hex').toUpperCase();
    const reffId = crypto.randomBytes(5).toString('hex').toUpperCase();

    const basePrice = chosen.harga;

    if (basePrice < 500) {
      return res.status(400).json({ ok: false, error: 'Harga dasar paket minimal Rp500 (sesuai standar API)' });
    }

    const expiredAt = expiryTimestamp(6);

    const payData = await requimeCreateQRIS({
      api_key: CONFIG.REQUIME_API_KEY,
      reff_id: reffId,
      basePrice
    });

    const totalPrice = payData.total_nominal;
    const tax = payData.fee;

    const qrPng = await QRCode.toDataURL(payData.qr_content, { margin: 2, scale: 8 });

    orders.set(orderId, {
      status: 'pending',
      username,
      phone,
      paket: String(paket).toLowerCase(),
      domain: domain || null,
      basePrice,
      tax,
      totalPrice,
      reffId,
      paymentId: payData.id,
      qr_content: payData.qr_content,
      paymentExpiredAt: payData.expired,
      createdAt: Date.now(),
      expiredAt,
      processed: false,
      result: null
    });

    // Notif Telegram: order baru
    telegramNotify(
      `🆕 <b>ORDER BARU MASUK</b>\n\n` +
      `👤 Username: <b>${username}</b>\n` +
      `📱 Phone: <b>${phone}</b>\n` +
      `📦 Paket: <b>${paket}</b>\n\n` +
      `💰 Harga Dasar: Rp${basePrice}\n` +
      `🧾 Total Bayar: Rp${totalPrice}\n\n` +
      `⌛ QRIS Kadaluarsa: ${payData.expired}\n` +
      `🆔 Order ID: <code>${orderId}</code>`
    );

    return res.json({
      ok: true,
      orderId,
      price: totalPrice,
      tax,
      basePrice,
      expiredAt,
      paymentExpiredAt: payData.expired,
      qr_png: qrPng
    });
  } catch (e) {
    console.error(e);
    let errorMessage = e.message || 'server error';
    if (errorMessage.includes('Requime create error')) {
      errorMessage = `Gagal membuat QRIS. Cek log server untuk detail Requime Response. (${errorMessage})`;
    }

    return res.status(500).json({ ok: false, error: errorMessage });
  }
});

// --- API: Get order status (poll) ---
app.get('/api/order/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    if (Date.now() >= order.expiredAt && order.status === 'pending') {
      order.status = 'expired';
    }

    if (order.status === 'success') return res.json({ ok: true, status: 'success', result: order.result });
    if (order.status === 'expired') return res.json({ ok: true, status: 'expired' });
    if (order.status === 'cancelled') return res.json({ ok: true, status: 'cancelled' });

    const payStatus = await requimeCheckStatus({
      api_key: CONFIG.REQUIME_API_KEY,
      id: order.paymentId
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
        const server = await pteroCreateServer({
          userId: user.id,
          name,
          memo: chosen.memo,
          cpu: chosen.cpu,
          eggId: CONFIG.EGG_ID,
          startup,
          locId: CONFIG.LOCATION_ID
        });

        const waktuBuat = moment().tz(CONFIG.TIMEZONE).format('DD/MM/YYYY HH:mm');
        const waktuExpired = moment().add(30, 'days').tz(CONFIG.TIMEZONE).format('DD/MM/YYYY');

        order.status = 'success';
        order.result = {
          login: CONFIG.PTERO_DOMAIN,
          username: user.username,
          password,
          phone: order.phone,
          memory: server.limits?.memory ?? chosen.memo,
          cpu: server.limits?.cpu ?? chosen.cpu,
          dibuat: waktuBuat,
          expired: waktuExpired,
          domain: order.domain,
          tagihan: {
            paket: order.paket,
            harga_dasar: order.basePrice,
            pajak: order.tax,
            total: order.totalPrice
          }
        };

        // Notif Telegram: pembayaran sukses + panel jadi
        telegramNotify(
          `✅ <b>PEMBAYARAN BERHASIL</b>\n\n` +
          `👤 Username: <b>${order.username}</b>\n` +
          `📱 Phone: <b>${order.phone}</b>\n` +
          `📦 Paket: <b>${order.paket}</b>\n\n` +
          `🖥 Panel Siap!\n` +
          `🔗 Login: ${CONFIG.PTERO_DOMAIN}\n` +
          `👤 User: <code>${order.result.username}</code>\n` +
          `🔑 Pass: <code>${order.result.password}</code>\n\n` +
          `💾 RAM: ${order.result.memory} MB\n` +
          `⚙ CPU: ${order.result.cpu}%\n` +
          `📅 Expired: ${order.result.expired}\n\n` +
          `🆔 Order ID: <code>${id}</code>`
        );

      } catch (err) {
        console.error('Error processing order:', err);
        order.status = 'error';
        order.result = { error: err.message };
      }
    } else if (payStatus === 'expired') {
      order.status = 'expired';
    } else if (payStatus === 'cancel') {
      order.status = 'cancelled';
    }

    if (order.status === 'success') return res.json({ ok: true, status: 'success', result: order.result });
    if (order.status === 'error') return res.json({ ok: false, status: 'error', error: order.result?.error || 'processing error' });
    if (order.status === 'expired') return res.json({ ok: true, status: 'expired' });
    if (order.status === 'cancelled') return res.json({ ok: true, status: 'cancelled' });

    return res.json({ ok: true, status: 'pending' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
});

// --- API: Cancel order ---
app.delete('/api/order/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);
    if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan' });
    if (order.status !== 'pending') return res.status(400).json({ ok: false, error: 'Order sudah diproses' });

    order.status = 'cancelled';

    try {
      await requimeCancelDeposit({
        api_key: CONFIG.REQUIME_API_KEY,
        id: order.paymentId
      });
    } catch (e) {
      console.warn('Requime cancel gagal / tidak tersedia:', e.message);
    }

    // optional: notif cancel
    telegramNotify(
      `⚠️ <b>ORDER DIBATALKAN</b>\n\n` +
      `👤 Username: <b>${order.username}</b>\n` +
      `📱 Phone: <b>${order.phone}</b>\n` +
      `📦 Paket: <b>${order.paket}</b>\n` +
      `🆔 Order ID: <code>${id}</code>`
    );

    return res.json({ ok: true, message: 'Order dibatalkan.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(CONFIG.PORT, () => {
  console.log(`BuyPanel server (Requime Edition) running on :${CONFIG.PORT}`);
});

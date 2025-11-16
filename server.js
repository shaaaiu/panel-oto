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

// --- CONFIG ---
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

// DB simple
const orders = new Map();

// PAKET DATA
const PAKET = {
  '1gb':  { harga: 2000, memo: 1048, cpu: 30 },
  '2gb':  { harga: 3000, memo: 2048, cpu: 50 },
  '3gb':  { harga: 4000, memo: 3048, cpu: 75 },
  '4gb':  { harga: 5000, memo: 4048, cpu: 100 },
  '5gb':  { harga: 6000, memo: 5048, cpu: 130 },
  '6gb':  { harga: 7000, memo: 6048, cpu: 150 },
  '7gb':  { harga: 8000, memo: 7048, cpu: 175 },
  '8gb':  { harga: 9000, memo: 8048, cpu: 200 },
  '9gb':  { harga: 10000, memo: 9048, cpu: 225 },
  '10gb': { harga: 12000, memo: 10048, cpu: 250 },
  'unli': { harga: 15000, memo: 999999, cpu: 500 }
};

function isValidUsername(u) {
  return /^[a-zA-Z0-9]{3,15}$/.test(u);
}
const expiryTimestamp = (m=6) => Date.now() + m*60*1000;

/* --- REQUIME QRIS --- */
async function requimeCreateQRIS({ api_key, reff_id, basePrice }) {
  const body = {
    nominal: String(basePrice),
    method: 'QRISFAST',
    fee_by_customer: 'false',
    reff_id,
    api_key
  };

  const res = await fetch("https://requimeboost.id/api/h2h/deposit/create", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  if (!res.ok) throw new Error("Requime HTTP " + res.status);

  const json = JSON.parse(raw);
  if (json.status !== 'success') throw new Error(json.message || 'Requime gagal');

  const d = json.data;
  return {
    id: d.id,
    qr_content: d.qr_image_string,
    expired: d.expired_at,
    total_nominal: d.nominal + d.fee,
    fee: d.fee
  };
}

async function requimeCheckStatus({ api_key, id }) {
  const res = await fetch("https://requimeboost.id/api/h2h/deposit/status", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ api_key, id: String(id) })
  });
  const j = await res.json();
  return j?.data?.status || "pending";
}

async function requimeCancelDeposit({ api_key, id }) {
  try {
    await fetch("https://requimeboost.id/api/h2h/deposit/cancel", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ api_key, id: String(id) })
    });
  } catch {}
}

/* --- PTERODACTYL --- */
async function pteroCreateOrGetUser({ email, username, password }) {
  const create = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization": `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      email, username,
      first_name: username,
      last_name: username,
      password
    })
  });

  const cj = await create.json();
  if (create.ok && !cj.errors) return cj.attributes;

  const find = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${email}`, {
    headers: { "Authorization": `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  const fj = await find.json();
  const user = fj?.data?.[0]?.attributes;
  if (!user) throw new Error("Gagal create/find user");
  return user;
}

async function pteroGetEggStartup({ nestId, eggId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/nests/${nestId}/eggs/${eggId}`, {
    headers: { "Authorization": `Bearer ${CONFIG.PTERO_APP_KEY}` }
  });
  const j = await res.json();
  return j?.attributes?.startup || "npm start";
}

async function pteroCreateServer({ userId, name, memo, cpu, eggId, startup, locId }) {
  const res = await fetch(`${CONFIG.PTERO_DOMAIN}/api/application/servers`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization": `Bearer ${CONFIG.PTERO_APP_KEY}`
    },
    body: JSON.stringify({
      name,
      user: userId,
      egg: eggId,
      docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
      startup,
      environment: {
        INST:"npm",
        CMD_RUN:"npm start"
      },
      limits: { memory: memo, cpu, disk: 0, io: 500, swap: 0 },
      feature_limits: { databases: 5, backups: 5, allocations: 1 },
      deploy: { locations: [locId], port_range: [] }
    })
  });

  const j = await res.json();
  if (!res.ok || j.errors) {
    console.log(j.errors);
    throw new Error("Gagal create server");
  }
  return j.attributes;
}

/* ============================================================
   🚀 API CREATE ORDER (USERNAME + PAKET + PHONE + TOTAL)
   ============================================================ */
app.post("/api/order", async (req, res) => {
  try {
    const { username, paket, phone, amount } = req.body;

    if (!isValidUsername(username))
      return res.json({ ok:false, error:"Username tidak valid" });

    if (!phone || !/^[0-9]{8,15}$/.test(phone))
      return res.json({ ok:false, error:"Nomor telepon invalid" });

    const c = PAKET[paket];
    if (!c) return res.json({ ok:false, error:"Paket tidak ditemukan" });

    // === Pajak tetap ===
    const pajakTetap = 250;

    // harga dasar
    let basePrice = c.harga + pajakTetap;

    // override jika frontend mengirim total
    if (amount && Number(amount) > 0) basePrice = Number(amount);

    if (basePrice < 500) return res.json({ ok:false, error:"Harga minimal 500" });

    const orderId = crypto.randomBytes(6).toString("hex").toUpperCase();
    const reff = crypto.randomBytes(5).toString("hex").toUpperCase();

    // CREATE QRIS
    const pay = await requimeCreateQRIS({
      api_key: CONFIG.REQUIME_API_KEY,
      reff_id: reff,
      basePrice
    });

    const qrPng = await QRCode.toDataURL(pay.qr_content);
    const expiredAt = expiryTimestamp(6);

    orders.set(orderId, {
      status: "pending",
      username,
      phone,
      paket,
      basePrice,
      pajakTetap,
      tax: pay.fee,
      totalPrice: pay.total_nominal,
      paymentExpiredAt: pay.expired,
      qr_content: pay.qr_content,
      paymentId: pay.id,
      expiredAt,
      createdAt: Date.now(),
      processed: false
    });

    res.json({
      ok: true,
      orderId,
      price: pay.total_nominal,
      expiredAt,
      paymentExpiredAt: pay.expired,
      qr_png: qrPng
    });

  } catch (err) {
    console.error(err);
    res.json({ ok:false, error: String(err.message) });
  }
});

/* ============================================================
   🚀 API CHECK PAYMENT STATUS
   ============================================================ */
app.get("/api/order/:id/status", async (req, res) => {
  try {
    const order = orders.get(req.params.id);
    if (!order) return res.json({ ok:false, error:"Order tidak ditemukan" });

    if (Date.now() >= order.expiredAt && order.status === "pending") {
      order.status = "expired";
      return res.json({ ok:true, status:"expired" });
    }

    // sudah success
    if (order.status === "success")
      return res.json({ ok:true, status:"success", result: order.result });

    const status = await requimeCheckStatus({
      api_key: CONFIG.REQUIME_API_KEY,
      id: order.paymentId
    });

    if (status === "success" && !order.processed) {
      order.processed = true;

      try {
        const email = `${order.username}@panel.com`;
        const password = `${order.username}001`;

        const usr = await pteroCreateOrGetUser({ email, username: order.username, password });
        const startup = await pteroGetEggStartup({ nestId: CONFIG.NEST_ID, eggId: CONFIG.EGG_ID });

        const pkg = PAKET[order.paket];
        const srv = await pteroCreateServer({
          userId: usr.id,
          name: `${order.username}${order.paket.toUpperCase()}`,
          memo: pkg.memo,
          cpu: pkg.cpu,
          eggId: CONFIG.EGG_ID,
          startup,
          locId: CONFIG.LOCATION_ID
        });

        const dibuat = moment().tz(CONFIG.TIMEZONE).format("DD/MM/YYYY HH:mm");
        const expired = moment().add(30, "days").tz(CONFIG.TIMEZONE).format("DD/MM/YYYY");

        order.status = "success";
        order.result = {
          username: usr.username,
          phone: order.phone,
          password,
          login: CONFIG.PTERO_DOMAIN,
          memory: srv.limits?.memory || pkg.memo,
          cpu: srv.limits?.cpu || pkg.cpu,
          dibuat,
          expired,
          tagihan: {
            paket: order.paket,
            harga_dasar: order.basePrice,
            pajak: order.tax,
            pajak_tetap: order.pajakTetap,
            total: order.totalPrice
          }
        };

        return res.json({ ok:true, status:"success", result: order.result });
      } catch (e) {
        order.status = "error";
        return res.json({ ok:false, status:"error", error:String(e.message) });
      }
    }

    if (status === "expired")
      return res.json({ ok:true, status:"expired" });

    return res.json({ ok:true, status:"pending" });

  } catch (e) {
    res.json({ ok:false, error:String(e.message) });
  }
});

/* ============================================================
   🚀 API CANCEL ORDER
   ============================================================ */
app.delete("/api/order/:id", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.json({ ok:false, error:"Order tidak ditemukan" });

  order.status = "cancelled";
  await requimeCancelDeposit({ api_key: CONFIG.REQUIME_API_KEY, id: order.paymentId });

  res.json({ ok:true, message:"Order dibatalkan" });
});

/* HEALTH */
app.get("/health", (req,res)=>res.json({ok:true}));

app.listen(CONFIG.PORT, () =>
  console.log("Server berjalan di port", CONFIG.PORT)
);

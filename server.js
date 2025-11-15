import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import moment from "moment-timezone";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// === ENV CONFIG ===
const CONFIG = {
  ORKUT_APIKEY: process.env.ORKUT_APIKEY,
  ORKUT_USERNAME: process.env.ORKUT_USERNAME,
  ORKUT_TOKEN: process.env.ORKUT_TOKEN,

  PTERO_DOMAIN: process.env.PTERO_DOMAIN,
  PTERO_APP_KEY: process.env.PTERO_APP_KEY,
  EGG_ID: parseInt(process.env.PTERO_EGG_ID || "15"),
  LOCATION_ID: parseInt(process.env.PTERO_LOCATION_ID || "1"),
  NEST_ID: parseInt(process.env.PTERO_NEST_ID || "5"),
  TIMEZONE: process.env.TIMEZONE || "Asia/Jakarta",
  PORT: parseInt(process.env.PORT || "3000"),
};

// === STORE ===
const orders = new Map();

// === PAKET ===
const PAKET = {
  "500mb": { harga: 500, memo: 546, cpu: 10 },
  "1gb": { harga: 2000, memo: 1048, cpu: 30 },
  "2gb": { harga: 3000, memo: 2048, cpu: 50 },
  "3gb": { harga: 4000, memo: 3048, cpu: 75 },
  "4gb": { harga: 5000, memo: 4048, cpu: 100 },
  "5gb": { harga: 6000, memo: 5048, cpu: 130 },
  "6gb": { harga: 7000, memo: 6048, cpu: 150 },
  "7gb": { harga: 8000, memo: 7048, cpu: 175 },
  "8gb": { harga: 9000, memo: 8048, cpu: 200 },
  "9gb": { harga: 10000, memo: 9048, cpu: 225 },
  "10gb": { harga: 12000, memo: 10048, cpu: 250 },
  unli: { harga: 15000, memo: 999999, cpu: 500 },
};

// ========================
function isValidUsername(u) {
  return /^[a-zA-Z0-9]{3,15}$/.test(u);
}
function expiryTimestamp(min = 6) {
  return Date.now() + min * 60 * 1000;
}
// ========================

// ===========================================================
// ====================== CREATE ORDER ========================
// ===========================================================
app.post("/api/order", async (req, res) => {
  try {
    if (!CONFIG.ORKUT_APIKEY)
      return res.json({ ok: false, error: "ORKUT APIKEY belum di .env" });

    const { username, paket, domain } = req.body || {};

    if (!isValidUsername(username))
      return res.json({ ok: false, error: "Username tidak valid" });

    const chosen = PAKET[paket];
    if (!chosen)
      return res.json({ ok: false, error: "Paket tidak dikenal" });

    const orderId = crypto.randomBytes(6).toString("hex").toUpperCase();
    const harga = chosen.harga;

    const expiredAt = expiryTimestamp(6);

    // ===========================
    // ORKUT: CREATE QRIS
    // ===========================
    const url =
      `https://apii.ryuuxiao.biz.id/orderkuota/createpayment` +
      `?apikey=${CONFIG.ORKUT_APIKEY}` +
      `&username=${CONFIG.ORKUT_USERNAME}` +
      `&token=${CONFIG.ORKUT_TOKEN}` +
      `&amount=${harga}`;

    console.log("[REQUEST ORKUT]", url);

    let reqQris = await axios.get(url);
    let dataQris = reqQris.data;

    console.log("[ORKUT RESPONSE]", dataQris);

    if (!dataQris.status)
      return res.json({
        ok: false,
        error: dataQris.message || "Gagal membuat QRIS",
      });

    let qrImage = dataQris.result.imageqris.url;
    let qrPng = await QRCode.toDataURL(qrImage);

    // Simpan order
    orders.set(orderId, {
      status: "pending",
      username,
      paket,
      domain: domain || null,
      totalPrice: harga,
      qrImage,
      expiredAt,
      createdAt: Date.now(),
      processed: false,
      result: null,
    });

    return res.json({
      ok: true,
      orderId,
      price: harga,
      expiredAt,
      qr_png: qrPng,
    });
  } catch (err) {
    console.log("[ERROR ORDER]", err);
    return res.json({ ok: false, error: err.message });
  }
});

// ===========================================================
// ====================== STATUS ORDER ========================
// ===========================================================
app.get("/api/order/:id/status", async (req, res) => {
  try {
    const id = req.params.id;
    const order = orders.get(id);

    if (!order) return res.json({ ok: false, error: "Order tidak ditemukan" });

    if (Date.now() > order.expiredAt && order.status === "pending") {
      order.status = "expired";
      return res.json({ ok: true, status: "expired" });
    }

    if (order.status !== "pending") {
      return res.json({ ok: true, status: order.status, result: order.result });
    }

    // ===========================
    // ORKUT: CHECK MUTASI
    // ===========================
    const url =
      `https://apii.ryuuxiao.biz.id/orderkuota/mutasiqr` +
      `?apikey=${CONFIG.ORKUT_APIKEY}` +
      `&username=${CONFIG.ORKUT_USERNAME}` +
      `&token=${CONFIG.ORKUT_TOKEN}`;

    let mutasiRes = await axios.get(url);
    let list = mutasiRes.data?.result || [];

    console.log("[MUTASI RAW]", list);

    // Cek apakah ada kredit masuk = jumlah totalHarga
    let sudahBayar = list.find((trx) => {
      let kredit = parseInt((trx.kredit || "0").replace(/\./g, ""));
      return trx.status === "IN" && kredit === order.totalPrice;
    });

    if (!sudahBayar) {
      return res.json({ ok: true, status: "pending" });
    }

    // ===========================
    // BUAT SERVER PTERO
    // ===========================
    if (!order.processed) {
      order.processed = true;

      try {
        const email = `${order.username}@panel.com`;
        const password = `${order.username}001`;

        // 1. get user or create  
        const createUser = await fetch(
          `${CONFIG.PTERO_DOMAIN}/api/application/users`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${CONFIG.PTERO_APP_KEY}`,
            },
            body: JSON.stringify({
              email,
              username: order.username,
              first_name: order.username,
              last_name: order.username,
              language: "en",
              password,
            }),
          }
        );

        let userRes = await createUser.json();
        let user;

        if (createUser.ok && !userRes.errors) {
          user = userRes.attributes;
        } else {
          // find user
          const listRes = await fetch(
            `${CONFIG.PTERO_DOMAIN}/api/application/users?filter[email]=${email}`,
            { headers: { Authorization: `Bearer ${CONFIG.PTERO_APP_KEY}` } }
          );
          const listJson = await listRes.json();
          user = listJson?.data?.[0]?.attributes;
          if (!user) throw new Error("User ptero gagal dibuat");
        }

        // get startup egg
        const getEgg = await fetch(
          `${CONFIG.PTERO_DOMAIN}/api/application/nests/${CONFIG.NEST_ID}/eggs/${CONFIG.EGG_ID}`,
          {
            headers: {
              Authorization: `Bearer ${CONFIG.PTERO_APP_KEY}`,
            },
          }
        );
        const eggJson = await getEgg.json();
        const startup = eggJson?.attributes?.startup || "npm start";

        // create server
        const chosen = PAKET[order.paket];
        const createServer = await fetch(
          `${CONFIG.PTERO_DOMAIN}/api/application/servers`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${CONFIG.PTERO_APP_KEY}`,
            },
            body: JSON.stringify({
              name: `${order.username}${order.paket}`,
              user: user.id,
              egg: CONFIG.EGG_ID,
              docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
              startup,
              environment: {
                INST: "npm",
                USER_UPLOAD: "0",
                AUTO_UPDATE: "0",
                CMD_RUN: "npm start",
              },
              limits: {
                memory: chosen.memo,
                swap: 0,
                disk: 0,
                io: 500,
                cpu: chosen.cpu,
              },
              feature_limits: {
                databases: 5,
                backups: 5,
                allocations: 1,
              },
              deploy: {
                locations: [CONFIG.LOCATION_ID],
                dedicated_ip: false,
                port_range: [],
              },
            }),
          }
        );

        const srvRes = await createServer.json();

        if (!createServer.ok || srvRes.errors)
          throw new Error("Gagal membuat server");

        const dibuat = moment().tz(CONFIG.TIMEZONE).format("DD/MM/YYYY HH:mm");
        const expired =
          moment().add(30, "days").tz(CONFIG.TIMEZONE).format("DD/MM/YYYY");

        order.status = "success";
        order.result = {
          login: CONFIG.PTERO_DOMAIN,
          username: user.username,
          password,
          memory: srvRes.attributes.limits.memory,
          cpu: srvRes.attributes.limits.cpu,
          dibuat,
          expired,
          domain: order.domain,
          total: order.totalPrice,
        };
      } catch (err) {
        console.log("[PTERO ERROR]", err);
        order.status = "error";
        order.result = { error: err.message };
      }
    }

    return res.json({
      ok: true,
      status: order.status,
      result: order.result,
    });
  } catch (error) {
    console.log("[STATUS ERROR]", error);
    return res.json({ ok: false, error: error.message });
  }
});

// --- CANCEL ORDER ---
app.delete("/api/order/:id", (req, res) => {
  const id = req.params.id;
  const order = orders.get(id);

  if (!order)
    return res.status(404).json({ ok: false, error: "Order tidak ditemukan" });
  if (order.status !== "pending")
    return res.status(400).json({ ok: false, error: "Order sudah diproses" });

  order.status = "cancelled";
  return res.json({ ok: true, message: "Order dibatalkan" });
});

// --- HEALTH ---
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(CONFIG.PORT, () => {
  console.log(`BuyPanel ORKUT Edition running on :${CONFIG.PORT}`);
});

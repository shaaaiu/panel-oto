import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import moment from 'moment-timezone';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios'; // Import axios untuk request ke API Orkut

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
    // Kunci API ORKUT
    ORKUT_API_KEY: process.env.ORKUT_API_KEY,
    ORKUT_USERNAME: process.env.ORKUT_USERNAME,
    ORKUT_TOKEN: process.env.ORKUT_TOKEN,
    // Biaya Admin (Fee/Pajak) dalam persentase, sesuai contoh Orkut
    TAX_RATE_PERCENT: parseFloat(process.env.TAX_RATE_PERCENT || '5'), // Contoh: 5%

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
// Expiry 6 menit
function expiryTimestamp(minutes = 6) { return Date.now() + minutes * 60 * 1000; } 


// --- Helper API Orkut (API xiaoprivate/orderkuota) ---

/**
 * Membuat pembayaran QRIS via API Orkut.
 */
async function orkutCreatePayment({ api_key, username, token, totalAmount }) {
    const apiUrl = `https://apii.ryuuxiao.biz.id/orderkuota/createpayment?apikey=${api_key}&username=${username}&token=${token}&amount=${totalAmount}`;
    
    console.log('[ORKUT CREATE REQUEST URL]', apiUrl);

    const res = await axios.get(apiUrl);

    console.log('[ORKUT CREATE RESPONSE DATA]', res.data);

    if (!res.data?.status) {
        throw new Error(`Orkut create payment error: ${res.data?.message || 'unknown'}`);
    }

    // API Orkut tidak mengembalikan expired_at/expired_in, jadi kita gunakan expiry lokal (6 menit)
    // dan hanya mengambil URL QRIS.
    const qrLink = res.data.result.imageqris.url; 
    
    return {  
        qr_content: qrLink, // URL QRIS
        // Karena tidak ada ID transaksi unik dari API ini, kita gunakan QR link sebagai ID
        paymentId: qrLink,   
    };
}

/**
 * Cek Status Mutasi Deposit Orkut.
 * API Orkut menggunakan cek mutasi untuk verifikasi pembayaran.
 * Mengembalikan 'success' jika totalAmount ditemukan di mutasi.
 */
async function orkutCheckStatus({ api_key, username, token, totalAmount }) {
    const mutasiUrl = `https://apii.ryuuxiao.biz.id/orderkuota/mutasiqr?apikey=${api_key}&username=${username}&token=${token}`;
    
    const res = await axios.get(mutasiUrl);
    const list = res.data?.result || [];

    // Cari mutasi yang statusnya 'IN' dan jumlahnya sama persis dengan totalAmount
    // Perhatikan: contoh Orkut menggunakan `parseInt(i.kredit.replace(/\./g, ""))`
    const result = list.find(i =>   
        i.status === "IN" &&   
        i.kredit && // Pastikan kredit ada
        parseInt(String(i.kredit).replace(/\./g, "")) === totalAmount
    );

    if (result) {
        return 'success';
    }
    
    // Status lain tidak bisa dipastikan dari API mutasi, kita anggap 'pending'
    return 'pending';
}

// Tidak ada fungsi pembatalan deposit di API Orkut ini (berdasarkan contoh)
async function orkutCancelPayment({ api_key, paymentId }) {
    console.warn(`[ORKUT CANCEL] Tidak ada API pembatalan untuk Orkut/Orderkuota. Order ID: ${paymentId}`);
    return { status: 'success', message: 'Tidak ada fungsi pembatalan.' };
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
        if (!CONFIG.ORKUT_API_KEY || !CONFIG.ORKUT_USERNAME || !CONFIG.ORKUT_TOKEN) {
            return res.status(500).json({ ok: false, error: 'Kunci API Orkut (ORKUT_API_KEY, ORKUT_USERNAME, ORKUT_TOKEN) tidak dikonfigurasi di .env' });
        }

        const { username, paket, domain } = req.body || {};  
        if (!isValidUsername(username)) return res.status(400).json({ ok:false, error:'Username 3–15 alfanumerik tanpa spasi' });  

        const chosen = PAKET[String(paket).toLowerCase()];  
        if (!chosen) return res.status(400).json({ ok:false, error:'Paket tidak dikenal' });  

        const orderId = crypto.randomBytes(6).toString('hex').toUpperCase();  
        // Reff ID di sini hanya untuk internal/log, tidak digunakan di API Orkut
        const reffId = crypto.randomBytes(5).toString('hex').toUpperCase();  
        
        const basePrice = chosen.harga;   
        
        // 1. Hitung Fee/Pajak secara lokal
        const tax = Math.ceil(basePrice * (CONFIG.TAX_RATE_PERCENT / 100));
        const totalPrice = basePrice + tax; 
        
        // Minimal nominal deposit (sesuaikan jika berbeda)  
        if (totalPrice < 1000) { // Orkut biasanya min 1000
            return res.status(400).json({ ok: false, error: 'Total harga paket minimal Rp1000' });
        }
        
        const expiredAt = expiryTimestamp(6); // 6 menit lokal expiry

        // 2. Panggil helper Orkut: kirim totalPrice sebagai nominal  
        const payData = await orkutCreatePayment({   
            api_key: CONFIG.ORKUT_API_KEY,
            username: CONFIG.ORKUT_USERNAME,
            token: CONFIG.ORKUT_TOKEN, 
            totalAmount: totalPrice // Kirim totalPrice ke helper  
        });  
        
        // Kita gunakan QR Link sebagai Payment ID karena API mutasi Orkut tidak menyediakan ID transaksi
        const qrPng = await QRCode.toDataURL(payData.qr_content, { margin: 2, scale: 8 });  

        orders.set(orderId, {  
            status: 'pending',  
            username, paket: String(paket).toLowerCase(), domain: domain || null,  
            basePrice,   
            tax,   
            totalPrice,   
            reffId,   
            paymentId: payData.paymentId, // QR Link (URL)  
            qr_content: payData.qr_content, // QR Link (URL)
            // Orkut API tidak memberikan expired_at, gunakan waktu expiry lokal:
            paymentExpiredAt: moment(expiredAt).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss'), 
            createdAt: Date.now(),   
            expiredAt,   
            processed: false,   
            result: null  
        });  

        return res.json({   
            ok:true,   
            orderId,   
            price: totalPrice, // Total harga yang harus dibayar user  
            tax,   
            basePrice,   
            expiredAt,   
            paymentExpiredAt: orders.get(orderId).paymentExpiredAt, // Waktu expired lokal
            qr_png: qrPng   
        });

    } catch (e) {
        console.error(e);
        let errorMessage = e.message || 'server error';
        if (errorMessage.includes('Orkut create payment error')) {
            errorMessage = `Gagal membuat QRIS. Cek log server untuk detail Orkut Response. (${errorMessage})`;
        }

        return res.status(500).json({ ok:false, error: errorMessage });
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
        }  

        if (order.status === 'success') return res.json({ ok:true, status:'success', result: order.result });  
        if (order.status === 'expired') return res.json({ ok:true, status:'expired' });  
        if (order.status === 'cancelled') return res.json({ ok:true, status:'cancelled' });  

        // Cek status dengan API Orkut
        const payStatus = await orkutCheckStatus({   
            api_key: CONFIG.ORKUT_API_KEY,   
            username: CONFIG.ORKUT_USERNAME,
            token: CONFIG.ORKUT_TOKEN,
            totalAmount: order.totalPrice // Cek mutasi berdasarkan total harga
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
        // Karena API Orkut hanya cek mutasi, status 'expired' atau 'cancel' 
        // hanya bisa ditetapkan berdasarkan waktu expired lokal.
        } 
        
        // Pterodactyl diproses (sukses/error), atau expired.
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
        // Izinkan pembatalan jika status pending atau expired
        if (order.status !== 'pending' && order.status !== 'expired') return res.status(400).json({ ok:false, error:'Order sudah diproses (sukses/error)' });

        order.status = 'cancelled';  

        // Batalkan deposit (jika ada) - di sini menggunakan helper Orkut yang hanya log warning
        try {  
            await orkutCancelPayment({  
                api_key: CONFIG.ORKUT_API_KEY,  
                id: order.paymentId   
            });  
        } catch (e) {  
            console.warn('Orkut cancel gagal / tidak tersedia:', e.message);  
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
    console.log(`BuyPanel server (Orkut Edition) running on :${CONFIG.PORT}`);
});

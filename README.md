# Buy Panel Otomatis (Express.js)

Sederhana, cepat, langsung jalan: frontend HTML + backend Express yang
membuat **order QRIS Atlantic** lalu **otomatis buat akun Pterodactyl**
setelah pembayaran sukses.

## Fitur
- Validasi `username` dan `nomor` (62...)
- Pilihan paket RAM (1GB - UNLI) dengan harga
- Generate QRIS Atlantic (`/deposit/create`) + hitung expiry (6 menit)
- Polling status pembayaran (`/deposit/status`) tiap 5 detik
- Jika sukses → buat user & server di Pterodactyl → kirim data login ke UI
- Waktu dibuat & tanggal expired (WIB)

## Struktur
```
.
├─ server.js
├─ package.json
├─ .env.example
└─ public/
   ├─ index.html
   ├─ app.js
   └─ styles.css
```

## Setup
1) **Node 18+** direkomendasikan (sudah ada `fetch` bawaan).
2) Install dep:
```
npm i
```
3) Buat file `.env` dari `.env.example` dan isi:
```
ATLANTIC_API_KEY=...
PTERO_DOMAIN=https://panel.xiao-store.web.id
PTERO_APP_KEY=...   # Application API Key (bukan client key user)
PTERO_NEST_ID=5
PTERO_EGG_ID=15
PTERO_LOCATION_ID=1
TIMEZONE=Asia/Jakarta
PORT=3000
```
> **Jangan commit API key ke git.**

4) Jalankan dev:
```
npm run dev
```
Buka: http://localhost:3000

## Catatan Penting
- **Storage:** Order disimpan di memory (Map). Untuk produksi, gunakan DB (Redis/SQL) dan ganti polling jadi webhook/callback yang aman.
- **Keamanan:** Pastikan server.js berjalan di backend saja. Frontend tidak pernah melihat **PTERO_APP_KEY** atau **ATLANTIC_API_KEY**.
- **Error handling:** Kode sudah cover error umum (duplicate user → fallback cari by email). Sesuaikan alur bila butuh strict idempotent.
- **Egg/Startup:** Ambil startup command dari endpoint egg. Docker image: `ghcr.io/parkervcp/yolks:nodejs_18`. Ubah sesuai kebutuhan.
- **Harga/Paket:** Edit di konstanta `PAKET` jika diperlukan.
- **Kadaluarsa QR:** default 6 menit (lihat `expiryTimestamp(6)`).

## Deploy
- VPS: `pm2 start server.js` atau systemd.
- Railway/Render: langsung deploy Node app, set env di dashboard.
- Reverse proxy (Nginx/Caddy) + HTTPS disarankan.

Selamat jualan! 🚀

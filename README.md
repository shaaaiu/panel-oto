# Buy Panel Otomatis (Express.js) – v3 (Username only + Toggle Paket)

Perubahan besar:
- Form **hanya username** (tanpa nomor).
- UI baru: tombol **Pilih Paket Panel** → daftar paket muncul sebagai panel (dropdown).
- Tombol **Batalkan Pembayaran** tetap tersedia (v2).
- Backend menyesuaikan: `/api/order` kini hanya butuh `username` & `paket`.

## Setup
```
npm i
cp .env.example .env
# Isi env (API key & domain)
npm run dev
```
Buka http://localhost:3000

## Catatan
- Simpan API key di `.env` (jangan di-commit).
- Untuk produksi, ganti penyimpanan order (Map) ke DB dan gunakan webhook pembayaran.

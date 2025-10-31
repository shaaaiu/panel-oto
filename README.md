# Buy Panel Otomatis (Express.js) – v4 (Modal + Domain + Auto-hide QR)

Perubahan:
- Selector **Modal** berisi **Domain** + **Paket** (1 tombol → muncul list seperti screenshot kamu).
- **QRIS auto-hide** setelah pembayaran sukses → langsung tampil card "Panel Siap".
- UI lebih modern: gradien, card glow, chip pilihan, animasi halus.
- Backend `/api/order` menerima `username`, `paket`, `domain` (domain tidak dipakai ke Pterodactyl, hanya informasi order).

## Setup
```
npm i
cp .env.example .env
# Isi env
npm run dev
```
Buka http://localhost:3000

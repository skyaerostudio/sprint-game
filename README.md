# Sprint Event Games 🎉

💣 **Bom Kentang Panas** + 🐙 **Satu Dalam Sejuta** + 🎭 **Fake It Till You Make It**, satu leaderboard individu. Lihat [SPEC.md](SPEC.md) dan [PRD_SATU_DALAM_SEJUTA.md](PRD_SATU_DALAM_SEJUTA.md) untuk detail aturan.

## Jalankan

```bash
npm install
npm start            # http://localhost:3000
```

| Halaman | Untuk |
|---|---|
| `/screen` | Laptop ke proyektor. **Klik sekali** di layar untuk menyalakan suara, lalu F11. |
| `/host` | Panel host. Password default: `sprint` (ganti lewat `HOST_PASSWORD`). |
| `/play` | HP pemain (scan QR di layar besar). |

### Environment variables

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | Port server |
| `HOST_PASSWORD` | `sprint` | Password panel host. **Ganti sebelum event.** |
| `PUBLIC_URL` | (kosong) | URL publik untuk QR, misal `https://sprint.up.railway.app`. Kalau kosong dan layar dibuka di `localhost`, QR otomatis pakai IP Wi-Fi laptop. |
| `DATA_DIR` | `./data` | Folder penyimpanan sesi, bank kata, mini-challenge, dan bank jawaban Satu Dalam Sejuta |

## Alur event (host)

1. Tab **📁 Sesi**: bikin sesi baru (nama squad + warna). Langsung tampil di layar besar dengan QR. Di kartu **Urutan game** pilih game mana yang dimainkan dan urutannya (default: Bom → Satu Dalam Sejuta → Fake It).
2. Pemain scan QR, isi nama + avatar, lalu tap **"Tap buat ikutan chaos!"**.
3. Tab **💣 Bom**: atur sumbu/ronde, lalu **Mulai Ronde** berkali-kali. Nyalakan **Bom Ganda** mulai ronde 4 dan **Mega Bom** di ronde terakhir (ada pengingat di panel). Selesai? **Akhiri Game**.
4. Tab **🐙 Satu Dalam Sejuta**: atur jumlah prompt (default 7) dan waktu jawab, lalu **Mulai prompt pertama**. Jawaban semua pemain kelihatan live (cuma di panel host). Banding diputus di kartu **Sidang Banding** (Sah + pilih tier / Sah + simpan ke daftar / Tolak); kalau lupa, setelah 30 detik otomatis Sah di tier 3. Setelah reveal, salah cocok bisa dikoreksi per pemain (skor dihitung ulang otomatis). Tekan **Prompt berikutnya** sampai habis, lalu **Akhiri Game**.
5. Tab **🎭 Fake It**: pilih kategori aktif, lalu **Mulai Ronde**. Penipu & kata rahasia bisa diintip di kotak "Rahasia" (tap untuk buka blur). Ada tombol Skip fase / Lewati giliran / +30 detik / Batalkan & ulang.
6. **📊 Tampilkan Leaderboard** kapan saja, lalu **🏆 Reveal Final** untuk penutupan (juara 3 → 2 → 1, confetti, gelar lucu).
7. Setelah selesai: **🔒 Tutup** sesi. Hasilnya tetap tersimpan dan bisa dilihat lagi di tab Sesi.

Skor manual, ganti nama, dan keluarkan pemain ada di tab **👥 Pemain & Skor**.

## Edit konten

- **Bank kata Fake It**: lewat tab **📚 Bank Kata** di panel host, atau edit [data/word-bank.json](data/word-bank.json). Dipakai bersama semua sesi; kata yang sudah keluar tidak diulang di sesi yang sama.
- **Bank jawaban Satu Dalam Sejuta**: sumber tunggal [data/prompts.json](data/prompts.json) (prompt, jawaban, alias, tier, Mutiara, Sok Pinter, catatan, skoring, sering_salah). Edit lewat tab **Bank Jawaban** di panel host (termasuk import/export JSON), atau langsung edit filenya. File divalidasi saat server start: kalau ada yang salah (Mutiara bukan tepat satu per prompt, tier di luar 1–5, jawaban/alias dobel, `sering_salah` ke prompt yang nggak ada), server **menolak start** dan menampilkan baris yang bermasalah. Setiap penulisan dari panel host membuat backup dulu di `data/backups/` (30 terakhir).
- **Mini-challenge bom**: edit [data/mini-challenges.json](data/mini-challenges.json) (pertanyaan jebakan, kata kebalik, pasangan emoji, warna, dll). Perubahan langsung terbaca tanpa restart.

## Tes sebelum event

```bash
npm start                                   # terminal 1
npm run test:unit                           # unit test: matcher, skoring, alur Satu Dalam Sejuta, editor bank
npm test                                    # terminal 2: unit test + 7 bot + host otomatis, main ketiga game, cek kebocoran
node scripts/simulate.js --code ABCD        # 7 bot join sesi yang sudah ada, kamu jalankan game dari /host
```

Tes otomatis (`npm test`) memeriksa:
- HP si Penipu tidak pernah menerima kata rahasia
- Penipu selalu dapat giliran di posisi ke-3 atau lebih
- Jumlah petunjuk benar (2 putaran)
- Reconnect pakai identitas tersimpan berhasil
- Satu Dalam Sejuta: HP tidak pernah menerima daftar jawaban/tier sebelum reveal, banding diputus, skor koreksi host pas, tiap pemain dapat hasilnya setelah reveal

## Ketahanan

- State tiap sesi disimpan ke `data/sessions/<id>.json` tiap 2 detik. Kalau server mati di tengah event, jalankan lagi saja: skor, ronde, penipu, dan kata rahasia kembali, dan HP pemain otomatis nyambung lagi.
- Setelah server restart ada jeda 10 detik sebelum giliran yang offline dilewati atau bom dilempar otomatis.
- HP yang sleep/refresh langsung masuk lagi ke state saat ini (identitas di `localStorage`).

## Deploy

**Railway / Render / Fly.io** (semuanya support WebSocket): start command `npm start`, set `HOST_PASSWORD` dan `PUBLIC_URL`. Catatan: disk di layanan ini biasanya terhapus saat redeploy. Pasang volume dan arahkan `DATA_DIR` ke volume itu kalau mau menyimpan sesi lama. **Penting untuk Satu Dalam Sejuta:** tanpa volume, jawaban yang di-"Sah + simpan" dan semua editan Bank Jawaban ikut hilang saat server restart/redeploy (paket gratis Render tidak punya disk). Pakai volume, atau **Export JSON** dari tab Bank Jawaban lalu commit ke `data/prompts.json`.

**Cadangan (laptop):** sambungkan laptop dan semua HP ke Wi-Fi kantor yang sama, `npm start`, buka `http://localhost:3000/screen`. QR otomatis pakai IP laptop. Kalau HP tidak bisa konek, izinkan Node.js di Windows Firewall (jaringan Private).

## Catatan perangkat

- iPhone tidak mendukung getar dari web. Getar hanya jalan di Android.
- Suara di HP butuh satu tap dulu (tombol join sudah menanganinya).
- Font (Bowlby One + Bricolage Grotesque) sudah ikut di `public/fonts/`, jadi tampilan sama persis walau Wi-Fi venue tidak ada internet.
- Tema warna sesi dipilih dari 10 warna sticker. Teks di atas warna tema otomatis hitam atau putih sesuai kontras.

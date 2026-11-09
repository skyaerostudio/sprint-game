# Sprint Event Games — Build Spec

Aplikasi web untuk Sprint Event per squad. **Satu squad main dalam satu waktu (~5–7 pemain)**, onsite. Aplikasi yang sama dipakai ulang untuk tiap squad, jadi setiap event adalah sesi baru.

**Bahasa:** SEMUA teks di aplikasi (layar HP pemain, big screen, panel host, notifikasi, caption lucu, mini-challenge, bank kata) wajib dalam **Bahasa Indonesia** yang santai dan lucu.

Dua game, satu leaderboard **individu**:

1. **Bom Kentang Panas (Hot Potato Bomb)** (pembuka, ~10–15 menit)
2. **Fake It Till You Make It** (penutup, ~20 menit)

Keduanya dimainkan individu. Pemenang keseluruhan (atau top 3) berdasarkan total poin dapat hadiah.

Semua pemain main pakai HP masing-masing. Satu laptop menampilkan big screen (proyektor/TV). Host mengontrol semuanya dari panel host (tab lain, atau HP host). Host tidak ikut main.

---

## 1. Tech stack (dibuat sesederhana mungkin)

- **Node.js + Express + Socket.IO**: satu server, state game disimpan di memory.
- **Frontend:** HTML/CSS/JS biasa atau React via Vite. Mobile-first, tombol besar, jalan di iOS Safari dan Android Chrome.
- **Deploy:** Railway, Render, atau Fly.io (harus support WebSocket). Cadangan: jalankan di laptop, HP join lewat IP Wi-Fi kantor.
- Simpan state tiap sesi ke file JSON setiap beberapa detik, supaya kalau server restart di tengah event skor tidak hilang.

## 2. Sesi (satu per event squad)

- Sebelum tiap event, host membuat **sesi baru**: isi nama squad (misal "Squad Phoenix") dan pilih warna tema.
- Tiap sesi punya kode join/QR, pemain, skor, dan hasil sendiri.
- Sesi lama tetap disimpan (read-only) supaya host bisa lihat pemenang tiap squad.
- **Bank kata** Fake It dipakai bersama semua sesi, tapi kata yang sudah dipakai di satu sesi tidak muncul lagi di sesi itu. Kata diambil acak, jadi squad berikutnya kemungkinan besar dapat kata berbeda.

## 3. Route / layar

| Route | Untuk | Fungsi |
|---|---|---|
| `/play` | Pemain (HP) | Join, lalu tampilkan apa pun yang dibutuhkan game saat itu |
| `/screen` | Big screen | Lobby dengan QR code, visual game, leaderboard |
| `/host` | Host (pakai password) | Buat sesi, jalankan game, ubah skor |

### Alur join
1. Pemain scan QR di `/screen`.
2. Isi nama tampilan dan (opsional) pilih avatar emoji.
3. Identitas disimpan di `localStorage`, jadi kalau halaman di-refresh atau layar HP terkunci, pemain otomatis join lagi (penting, karena HP pasti sering sleep).
4. Lobby di `/screen` menampilkan pemain yang masuk lengkap dengan avatarnya.
5. Tombol besar "Tap buat ikutan chaos!" saat join (sekaligus membuka audio di iOS).

## 4. Leaderboard

- **Skor individu**, berlanjut dari game 1 ke game 2.
- `/screen` menampilkan leaderboard di antara ronde dan di akhir dengan reveal dramatis (animasi angka naik, juara 3 → 2 → 1, confetti).
- Host bisa menambah/mengurangi poin tiap pemain secara manual.
- Gelar lucu di akhir event:
  - "💣 Paling Sering Meledak"
  - "⚡ Tangan Tercepat" (rata-rata oper bom paling cepat)
  - "🎭 Aktor Terbaik" (penipu yang paling sering lolos)
  - "🕵️ Detektif Kantor" (paling banyak menebak penipu dengan benar)
  - "🤡 Paling Sering Dituduh" (paling banyak dapat vote padahal bukan penipu)

---

## 5. Game 1 — Bom Kentang Panas (individu)

### Konsep
Sebuah bom muncul di HP salah satu pemain secara acak. Untuk mengoper bom, pemain harus menyelesaikan mini-challenge singkat, lalu melempar bom ke pemain lain. Ada timer rahasia yang terus berjalan. Siapa pun yang memegang bom saat meledak akan kehilangan poin.

### Alur ronde
1. Host menekan **Mulai Ronde**. Server memilih pemain awal secara acak dan **waktu sumbu rahasia** (acak 15–40 detik; host bisa atur rentangnya).
2. **HP pemegang bom:** layar penuh merah/oranye, bom berdenyut, suara detak, dan menampilkan mini-challenge.
3. **HP pemain lain:** "💣 Budi lagi pegang bom!" plus skor mereka sendiri.
4. **Big screen:** bom raksasa dengan nama dan avatar pemegang, jejak operan terakhir (Budi → Sari → Dimas…), dan sumbu yang "terbakar" **tanpa menunjukkan sisa waktu sebenarnya** (animasi sumbu tidak teratur biar tegang).
5. Pemegang menyelesaikan challenge, lalu memilih target dari daftar pemain (atau tekan "Lempar Acak"), dan bom terbang ke target dengan animasi "whoosh" di big screen.
6. Jawaban salah berarti terkunci 3 detik, lalu dapat challenge baru.
7. **Ledakan:** layar HP pemegang berkedip putih/merah, ada suara "DUAR", plus getar di Android (iOS tidak mendukung getar dari web). Big screen menampilkan animasi ledakan dan caption lucu ("Budi telah menjadi abu 💀", "RIP Sari, gugur dalam tugas").

### Aturan / skor
- Meledak: **−100** untuk pemegang bom.
- Tiap berhasil mengoper: **+10** untuk yang mengoper.
- **Tidak boleh oper balik:** tidak bisa melempar ke orang yang barusan melempar ke kamu.
- **Aturan Balas Dendam (opsional, toggle host):** yang meledak memulai ronde berikutnya sambil memegang bom.
- Kalau pemegang bom terputus lebih dari 5 detik, bom otomatis dilempar ke pemain acak.
- Main **6–8 ronde**. Host bisa mengakhiri lebih cepat.

### Eskalasi
- **Ronde 4+: Bom Ganda.** Dua bom sekaligus. Kalau satu orang memegang dua bom saat meledak, penaltinya dobel.
- **Ronde terakhir: Mega Bom.** Ledakan −200, sumbu lebih pendek, dan tiap operan +20.
- Host mengaktifkan ini dari panel.

### Mini-challenge (dinilai otomatis, 2–6 detik)
Dipilih acak; jangan ulang challenge yang sama untuk pemain yang sama dalam satu ronde.
- **Tap gila-gilaan:** tap bomnya 15 kali.
- **Hitung cepat:** `7 × 8 = ?` dengan 4 pilihan.
- **Cari yang beda:** grid 9 emoji; tap yang berbeda (🍎🍎🍎🍎🍏🍎…).
- **Ketik kebalik:** muncul `GNASIP`, ketik "PISANG" (kata pendek saja).
- **Jebakan warna:** tulisan "MERAH" berwarna biru; tap *warna tulisannya*.
- **Pertanyaan jebakan** (pilihan ganda): "Mana yang lebih berat, 1 kg kapas atau 1 kg besi?" → "Sama". "Ada berapa bulan yang punya tanggal 28?" → "Semuanya".
- **Geser untuk menjinakkan:** geser slider ke zona sempit.
- **Tahan:** tekan dan tahan tepat 2 detik (±0,3 detik).

Challenge disimpan di file JSON supaya host bisa menambah sendiri.

---

## 6. Game 2 — Fake It Till You Make It (individu, penutup)

### Konsep
Semua pemain dapat **kata rahasia** yang sama, kecuali satu orang: **si Penipu**. Si Penipu hanya tahu kategorinya. Satu per satu, semua pemain memberi **satu kata petunjuk**. Pemain asli harus membuktikan mereka tahu kata rahasianya tanpa terlalu jelas (biar si Penipu tidak bisa menebak). Si Penipu harus pura-pura tahu. Setelah itu semua vote: siapa penipunya?

### Alur ronde
1. Host menekan **Mulai Ronde**. Server memilih:
   - satu **Penipu** secara acak (setiap pemain jadi Penipu maksimal satu kali sampai semua sudah pernah kebagian), dan
   - satu **kata rahasia** acak dari bank kata, beserta kategorinya.
2. **HP pemain biasa:** "Kategori: Makanan — Kata rahasia: **MARTABAK**". Ada tombol tahan-untuk-lihat supaya orang sebelah tidak bisa mengintip.
3. **HP si Penipu:** "🎭 Kamu PENIPU! Kategori: Makanan. Jangan sampai ketahuan…" (layar dan tombol tahan-untuk-lihat dibuat **identik** dengan pemain biasa, supaya reaksi wajah tidak membocorkan).
4. **Fase Petunjuk (2 putaran):** urutan pemain diacak. Giliran tiap pemain 20 detik untuk mengetik **satu kata**.
   - Petunjuk langsung muncul di big screen di samping avatar pemain, dengan animasi.
   - Tidak boleh menulis kata rahasia itu sendiri atau kata yang mengandungnya (ditolak otomatis, tanpa membocorkan alasan ke layar umum).
   - Tidak boleh mengulang petunjuk yang sudah dipakai di ronde itu.
   - Hanya satu kata (tanpa spasi), maksimal 20 karakter.
   - Kalau waktu habis, petunjuknya jadi "🤐 …" (mencurigakan!).
   - Si Penipu baru dapat giliran di **posisi ke-3 atau lebih** pada putaran pertama, supaya sempat dengar petunjuk orang lain.
5. **Fase Diskusi (60 detik):** big screen menampilkan semua petunjuk dan timer. Pemain debat secara langsung. Host bisa skip atau tambah waktu.
6. **Fase Vote (20 detik):** di HP, tiap pemain memilih satu orang yang dicurigai (tidak bisa vote diri sendiri). Si Penipu juga vote (biar tidak ketahuan).
7. **Reveal:** big screen membuka vote satu per satu dengan animasi (panah dari pemilih ke yang dipilih), lalu drumroll… topeng si Penipu dibuka dengan caption lucu ("Ternyata DIMAS penipunya! 😱", "Sari sukses menipu kalian semua 🎭").
8. **Kesempatan Terakhir:** kalau si Penipu tertangkap, dia dapat 15 detik untuk **menebak kata rahasia**. Pencocokan tidak case-sensitive dan mengabaikan spasi.

### Aturan / skor
- **Si Penipu tidak tertangkap** (bukan yang paling banyak divote, atau seri): Penipu **+150**.
- **Si Penipu tertangkap:** setiap pemain yang vote dia **+50**.
- **Penipu tertangkap tapi berhasil menebak kata:** Penipu **+100** ("Comeback!"). Pemain yang benar tetap dapat +50.
- Pemain biasa yang paling banyak divote padahal bukan Penipu: **−20** ("Kenapa kamu mencurigakan banget sih?"). Toggle host, default aktif.
- **Ronde terakhir: Poin Dobel.** Semua poin ×2.
- Jumlah ronde = jumlah pemain (5–7 ronde), supaya semua pernah jadi Penipu sekali. Host bisa mengurangi atau mengakhiri lebih cepat.
- Kalau pemain terputus saat gilirannya, gilirannya dilewati dengan "🤐 …". Kalau si Penipu terputus lebih dari 30 detik, ronde dibatalkan tanpa poin dan diulang.

### Bank kata (file JSON yang bisa diedit)
Format: `{ "kategori": "Makanan", "kata": ["Martabak", "Seblak", …] }`. Kata harus cukup umum supaya semua orang tahu. Contoh awal:

| Kategori | Kata |
|---|---|
| Makanan | Martabak, Seblak, Nasi Padang, Bakso, Sate, Gorengan, Indomie, Rendang, Es Teh, Kerupuk |
| Tempat | Monas, Ancol, Bali, Mall, Stasiun, Bandara, Pantai, Puncak, Pasar, Bioskop |
| Kantor | Meeting, Lembur, Gajian, Rapat Zoom, Pantry, Lift, Printer, Absen, Cuti, Deadline |
| Hewan | Kucing, Cicak, Ayam, Kambing, Gajah, Nyamuk, Ikan Lele, Monyet, Bebek, Komodo |
| Kegiatan | Mudik, Kondangan, Arisan, Karaoke, Nongkrong, Jogging, Rebahan, Belanja Online, Ngopi, Begadang |
| Benda | Payung, Helm, Sendal Jepit, Kipas Angin, Galon, Rice Cooker, Charger, Kunci Motor, Remote TV, Bantal |

Host bisa menambah kategori dan kata sendiri (misal inside joke squad). Di panel host, host bisa memilih kategori mana yang aktif untuk sesi itu.

---

## 7. Panel host

- Buat, buka, atau tutup sesi; lihat sesi lama (pemenang).
- Lihat pemain yang terhubung; keluarkan atau ganti nama pemain.
- **Game 1:** mulai ronde, atur rentang sumbu, toggle Balas Dendam/Bom Ganda/Mega Bom, akhiri game.
- **Game 2:** mulai ronde, pilih kategori aktif, skip/tambah waktu diskusi, toggle penalti "paling dituduh", toggle Poin Dobel, lewati giliran pemain, batalkan & ulang ronde, akhiri game. Host bisa melihat siapa Penipu dan kata rahasianya (di panel host saja, **tidak pernah** di big screen sebelum reveal).
- Ubah skor manual per pemain.
- Tombol "Tampilkan Leaderboard" ke big screen kapan saja.
- Tombol "Reveal Final" untuk penutupan.
- Reset sesi (dengan konfirmasi).

## 8. Polish yang paling penting

- **Efek suara** di big screen: detak bom, ledakan, "whoosh" saat oper, suara "pop" saat petunjuk muncul, drumroll saat reveal Penipu dan reveal final.
- **Anti-ngintip:** kata rahasia hanya muncul selama tombol ditahan; layar Penipu dan pemain biasa terlihat sama dari jauh (warna, ukuran, layout).
- Server tidak pernah mengirim kata rahasia ke HP si Penipu (cek di sisi server, bukan cuma disembunyikan di UI).
- Avatar dan warna supaya pemain mudah dikenali sekilas.
- Layar HP harus terbaca sekilas: teks besar, UI minimal.
- Reconnect mulus: HP yang sempat sleep langsung masuk lagi ke state saat ini (termasuk peran Penipu/kata rahasia).
- Tes dengan ~7 client simulasi (script yang membuka pemain socket palsu) sebelum event pertama.

## 9. Urutan build

1. Server, sesi, alur join, lobby di `/screen`, kerangka panel host, leaderboard.
2. Bom Kentang Panas: loop inti, lalu mini-challenge, animasi/suara, eskalasi.
3. Fake It Till You Make It: pembagian peran + kata, fase petunjuk, diskusi, vote, reveal, kesempatan terakhir, skor.
4. Layar reveal final dan gelar akhir event.
5. Deploy, tes di iPhone dan Android asli, dry run dengan 3–4 orang.
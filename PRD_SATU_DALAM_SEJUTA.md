# PRD — Mode Game Baru: "Satu Dalam Sejuta" 🐙

Mode ketiga untuk aplikasi Sprint Event Games, terinspirasi dari game viral **Krillion** (krillion.io). Dokumen ini melengkapi `SPEC.md`: semua aturan sesi, join, leaderboard individu, panel host, dan bahasa (full Bahasa Indonesia) tetap berlaku.

**Sumber data:** semua prompt, jawaban, tier, alias, dan angka skoring mode ini diambil dari **`data/prompts.json`** (file terlampir, versi 2026-11-17). File `Bank_Jawaban_Satu_Dalam_Sejuta.xlsx` hanya salinan untuk review manusia; aplikasi **tidak** membaca Excel.

---

## 1. Latar belakang: analisis Krillion

### Apa itu Krillion
- Game tebak-kategori harian berbasis web: **7 prompt per hari, sama untuk semua orang**.
- Tiap prompt minta pemain menyebutkan sesuatu dari satu kategori. **Jawaban langka membuat kamu "menyelam" lebih dalam; jawaban yang terlalu umum hampir tidak dihitung.**
- Temanya laut dalam: skor berupa kedalaman, dengan tier sampai level tertinggi "Krillion" ("one in a krillion").
- Ada mode Unlimited, Archive, Themed Packs, Friends, dan mode multiplayer **Puffer Party** (oper ikan buntal sebelum meledak, mirip hot potato).

### Kenapa viral
1. **Twist sederhana dari kuis biasa:** yang dicari bukan jawaban *benar*, tapi jawaban benar yang *paling tidak terpikirkan orang lain*. Setiap orang merasa "aku tahu yang aneh-aneh".
2. **Momen pamer:** mendapat jawaban paling dalam ("Krillion") terasa seperti jackpot, dan hasilnya enak di-share.
3. **Rasa "harusnya aku jawab itu!":** setelah ronde, pemain melihat jawaban langka yang terlewat.
4. **Label lucu "too clever":** jawaban yang dikira obscure padahal pasaran.
5. **Kurasi + toleransi typo:** daftar jawaban besar dengan alias dan autocorrect, jadi pemain jarang merasa dicurangi.
6. **Gem dipilih juga karena faktor seru**, bukan semata paling langka, supaya masih ada yang bisa menebaknya.

### Apa yang kita ambil
- Inti mekanik: **kategori + skor kelangkaan + tema menyelam**.
- Label "terlalu pintar" dan jawaban permata (gem).
- Reveal "yang lebih dalam lagi" setelah ronde.

### Apa yang kita ubah untuk konteks squad (5–7 orang, onsite)
- Bukan harian/solo, tapi **ronde bersamaan di satu ruangan** dengan reveal di big screen.
- Kelangkaan dihitung **dua lapis**: tier kurasi (seberapa langka secara umum) + **bonus "Sendirian"** kalau tidak ada orang lain di ruangan yang menjawab sama. Ini membuat pemain saling menebak isi kepala teman.
- Jawaban yang tidak ada di daftar tidak langsung dianggap salah, tapi masuk ke **"Sidang Banding"** yang diputuskan host secara live (sumber debat dan tawa).
- Catatan: Puffer Party Krillion mirip dengan Bom Kentang Panas kita, jadi mode yang diambil adalah mode inti (menyelam), bukan mode party-nya.

---

## 2. Ringkasan mode

| Item | Detail |
|---|---|
| Nama | **Satu Dalam Sejuta** |
| Pemain | 5–7, individu |
| Durasi | ~12–15 menit |
| Jumlah prompt | 7 per game, diambil acak dari 16 prompt di `data/prompts.json` (host bisa ubah 5–10) |
| Perangkat | HP pemain, big screen, panel host |
| Posisi di event | Disarankan di tengah: Bom Kentang Panas → **Satu Dalam Sejuta** → Fake It Till You Make It. Host bisa memilih urutan dan mode mana yang dimainkan per sesi. |

**Satu kalimat:** sebutkan sesuatu dari kategori, tapi cari jawaban yang *benar dan paling langka*, karena semakin langka semakin dalam kamu menyelam.

---

## 3. Alur satu prompt

1. **Prompt muncul** di big screen dan semua HP, misal: *"Sebutkan nama buah"*. Suara "blub" dan animasi permukaan laut.
2. **Fase Jawab (25 detik):** setiap pemain mengetik **satu jawaban** secara rahasia di HP.
   - Saat dikirim, aplikasi langsung mengecek ke daftar jawaban (dengan alias + toleransi typo).
   - **Ditemukan:** HP menampilkan "✅ Diterima. Kedalaman dirahasiakan sampai reveal 🤫".
   - **Tidak ditemukan:** pemain bisa **coba lagi** (maksimal 2 kali), atau tekan **"Ajukan Banding"** agar host yang memutuskan.
   - Jawaban terakhir yang dikunci adalah yang dihitung. Pemain bisa menekan "Kunci" lebih awal.
   - Big screen hanya menampilkan siapa yang sudah mengunci (avatar berubah jadi penyelam 🤿), bukan isinya.
3. **Sidang Banding (jika ada):** big screen menampilkan jawaban yang dibanding, misal *"Buah Kepel?"*. Host menekan **Sah** (lalu memilih tier) atau **Tolak**. Waktu maksimal 30 detik per banding. Pemain lain boleh teriak-teriak ikut menilai.
4. **Reveal (dari dangkal ke dalam):**
   - Big screen menampilkan penampang laut vertikal dengan zona kedalaman.
   - Jawaban dibuka **satu per satu dari yang paling umum ke paling langka**. Avatar penyelam tiap pemain turun ke kedalaman jawabannya, lengkap dengan suara gelembung.
   - Jawaban yang sama dari 2+ pemain ditampilkan bergandengan dengan label "💥 Tabrakan!".
   - Jawaban terdalam dapat sorotan khusus. Kalau ada yang mendapat **Mutiara**, layar penuh berkilau: "🦪 SATU DALAM SEJUTA!".
5. **"Yang lebih dalam lagi…":** big screen menampilkan 3 jawaban langka dari daftar yang tidak disebut siapa pun, plus Mutiara prompt ini kalau tidak ada yang mendapatkannya. (Ini momen "aduh, harusnya aku jawab itu!")
6. **Klasemen kedalaman** singkat, lalu prompt berikutnya.

---

## 4. Zona kedalaman dan skor

Setiap jawaban di daftar punya satu tier. Poin langsung masuk ke leaderboard individu event (skala disamakan dengan mode lain).

Tabel di bawah adalah nilai default. **Aplikasi wajib membaca angka dari objek `skoring` di `data/prompts.json`**, bukan hardcode, supaya host bisa mengubah poin tanpa mengubah kode.

| Tier | Nama zona | Kedalaman (tampilan) | Poin |
|---|---|---|---|
| 1 | 🏖️ Permukaan | 5 m | 10 |
| 2 | 🐠 Terumbu Karang | 50 m | 25 |
| 3 | 🌗 Zona Senja | 200 m | 50 |
| 4 | 🌑 Zona Gelap | 1.000 m | 80 |
| 5 | 🦑 Palung | 5.000 m | 120 |
| ★ | 🦪 **Mutiara** (1 per prompt) | 10.000 m | 200 |

### Modifier
- **🫂 Tabrakan:** kalau 2+ pemain memberi jawaban yang sama, masing-masing hanya dapat **50%** poin tier. Ini mendorong pemain menebak apa yang *tidak* akan dijawab teman.
- **🏝️ Sendirian:** jawaban valid yang tidak dijawab siapa pun lagi di ruangan mendapat **+15**.
- **🤓 Sok Pinter:** beberapa jawaban di daftar ditandai "terlalu pintar", yaitu yang dikira langka padahal pasaran (misal "Durian" untuk kategori buah). Skornya tetap sesuai tier aslinya (biasanya Permukaan/Terumbu), tapi saat reveal muncul cap "🤓 SOK PINTER" dan efek suara "tetot". Pure untuk ditertawakan.
- **🫧 Ngambang:** kosong, tidak valid, atau ditolak saat banding = 0 poin, dengan avatar terlihat mengambang di permukaan memakai pelampung.
- **Prompt terakhir: Penyelaman Ganda.** Semua poin ×2 (host bisa mematikan).

### Gelar akhir event (tambahan untuk daftar di SPEC.md)
- "🐙 Penghuni Palung": total kedalaman tertinggi di mode ini.
- "🛟 Si Pelampung": paling sering menjawab tier Permukaan.
- "🤓 Profesor Sok Pinter": paling sering kena cap Sok Pinter.
- "🦪 Pemburu Mutiara": yang mendapatkan Mutiara (kalau ada).

---

## 5. Konten: bank prompt dan daftar jawaban

### Sumber data: `data/prompts.json`
Bank jawaban sudah dibuat dan direview (16 prompt, **2.229 jawaban**). Struktur file:

```json
{
  "versi": "2026-11-17",
  "mode": "Satu Dalam Sejuta",
  "skoring": {
    "tier": {
      "1": { "zona": "Permukaan", "emoji": "🏖️", "kedalaman_m": 5, "poin": 10 },
      "...": "tier 2–5"
    },
    "mutiara": { "zona": "Mutiara", "emoji": "🦪", "kedalaman_m": 10000, "poin": 200 },
    "modifier": { "tabrakan_persen": 50, "sendirian_bonus": 15, "ngambang_poin": 0, "prompt_terakhir_kali": 2 }
  },
  "prompts": [
    {
      "id": "buah",
      "prompt": "Sebutkan nama buah",
      "kategori_bebas_tambah": false,
      "jawaban": [
        { "teks": "Pisang", "tier": 1 },
        { "teks": "Durian", "tier": 1, "sok_pinter": true },
        { "teks": "Sirsak", "alias": ["Nangka Belanda"], "tier": 3 },
        { "teks": "Maja", "alias": ["Buah Maja"], "tier": 5, "mutiara": true,
          "catatan": "Asal nama Majapahit." }
      ]
    }
  ],
  "sering_salah": [
    { "prompt_id": "kota", "jawaban": "Bali", "alasan": "Provinsi/pulau, bukan kota" }
  ]
}
```

| Field | Arti |
|---|---|
| `teks` | Nama resmi jawaban, ditampilkan di HP dan big screen |
| `alias` | (opsional) nama lain/singkatan yang juga diterima, misal "Jabar" untuk "Jawa Barat" |
| `tier` | 1–5 (lihat §4) |
| `mutiara` | (opsional) `true` untuk tepat satu jawaban per prompt. Poinnya pakai `skoring.mutiara`, bukan tier |
| `sok_pinter` | (opsional) `true` untuk memunculkan cap 🤓 SOK PINTER saat reveal; poin tetap sesuai tier |
| `catatan` | (opsional) info untuk host, ditampilkan di panel host saat banding/reveal |
| `sering_salah` | Jawaban yang sering diajukan tapi biasanya tidak sah. Matcher **tidak** mencocokkannya ke jawaban mana pun; jawaban ini langsung masuk Sidang Banding dengan alasan dari file ditampilkan di panel host |

Saat server start, aplikasi wajib memvalidasi file: setiap prompt punya tepat satu `mutiara`, `tier` hanya 1–5, tidak ada `teks`/`alias` yang dobel dalam satu prompt (setelah normalisasi), dan setiap `sering_salah.prompt_id` ada. Kalau validasi gagal, server menolak start dan menampilkan baris yang bermasalah.

### Isi bank saat ini
| Prompt ID | Prompt | Jawaban | Mutiara |
|---|---|---|---|
| buah | Sebutkan nama buah | 85 | Maja |
| provinsi | Sebutkan provinsi di Indonesia | 38 (lengkap) | Papua Barat Daya |
| kota | Sebutkan nama kota di Indonesia | 209 | Sungai Penuh |
| hewan | Sebutkan nama hewan | 186 | Pesut |
| makanan | Sebutkan makanan khas Indonesia | 215 | Binte Biluhuta |
| motor | Sebutkan merek motor | 85 | Jialing |
| mobil | Sebutkan merek mobil | 111 | Timor |
| olahraga | Sebutkan cabang olahraga | 153 | Gobak Sodor |
| sayur | Sebutkan nama sayuran | 112 | Leunca |
| minuman | Sebutkan nama minuman | 116 | Laksamana Mengamuk |
| kantor | Sebutkan benda yang ada di kantor *(bebas tambah)* | 162 | Foto Presiden |
| telat | Sebutkan alasan telat masuk kantor *(bebas tambah)* | 93 | Ayam Tetangga Lepas |
| negara | Sebutkan nama negara | 197 | Tuvalu |
| profesi | Sebutkan nama profesi atau pekerjaan | 216 | Joki 3 in 1 |
| warna | Sebutkan nama warna | 122 | Hijau Telur Bebek |
| bumbu | Sebutkan bumbu dapur atau rempah | 129 | Andaliman |

### Aturan konten
- Bank berisi **16 prompt**; satu game memakai 7 secara acak (tidak berulang dalam satu sesi, dan diusahakan berbeda antar-squad).
- Fokus bank adalah **kedalaman jawaban**, bukan banyaknya prompt: tiap prompt punya puluhan sampai 200+ jawaban dengan sebaran tier, supaya hampir semua jawaban wajar sudah tercakup dan banding jarang terjadi.
- Tier disusun berdasarkan seberapa sering orang Indonesia kemungkinan menyebutnya, lalu disesuaikan dengan konteks squad (misal "Penaksir" untuk profesi dibuat pasaran + Sok Pinter karena squad bekerja di kantor gadai).
- Fakta yang meragukan sudah dicek ke sumber web (daftar 38 provinsi, merek motor lokal, minuman daerah, nama lokal hewan); entri yang tidak terverifikasi dibuang.
- Jawaban yang di-Sah-kan host saat banding dengan opsi "Sah + simpan ke daftar" **ditulis balik ke `data/prompts.json`** (dengan tier pilihan host) untuk sesi berikutnya. Server menyimpan backup file sebelum menulis.

### Contoh sebaran jawaban (dangkal → dalam)
| Prompt | Contoh dangkal → dalam |
|---|---|
| Sebutkan nama buah | Pisang, Apel → Rambutan, Salak → Sirsak, Kedondong → Matoa, Gandaria → Kepel, Kawista |
| Sebutkan provinsi di Indonesia | Jawa Barat, Bali → Sumatera Utara → Gorontalo → Papua Pegunungan |
| Sebutkan hewan yang ada di Indonesia | Kucing, Ayam → Komodo → Tarsius, Anoa → Babirusa |
| Sebutkan makanan berkuah | Bakso, Soto → Rawon, Coto → Pindang Patin → Kapurung |
| Sebutkan sesuatu yang ada di kantor | Laptop, Meja → Stapler → Paper shredder → Fire blanket |
| Sebutkan alasan telat masuk kantor | Macet, Hujan → Ban bocor → KRL gangguan → Jemuran belum diangkat |
| Sebutkan merek motor | Honda, Yamaha → Kawasaki → Vespa → Benelli |
| Sebutkan olahraga | Sepak bola, Badminton → Futsal → Sepak takraw → Curling |
| Sebutkan benda berwarna kuning | Pisang, Matahari → Kuning telur → Kunyit → Bunga sepatu kuning |
| Sebutkan nama kota di Indonesia | Jakarta, Bandung → Malang → Ternate → Sawahlunto |

Prompt bertipe "alasan" atau "sesuatu yang…" (jawaban bebas) diberi `kategori_bebas_tambah: true`: lebih banyak jawaban akan masuk banding, dan itu memang bagian lucunya.

---

## 6. Pencocokan jawaban (penting supaya terasa adil)

1. **Normalisasi:** huruf kecil, buang spasi, tanda hubung, tanda baca, dan awalan umum seperti "buah", "kota", "provinsi" bila kategori sudah jelas ("buah matoa" = "matoa").
2. **Alias:** cocokkan ke `teks` maupun `alias` (misal "Jabar" = "Jawa Barat", "Sepak bola" = "Bola").
3. **Cocok persis selalu menang:** kalau hasil normalisasi sama persis dengan `teks` atau `alias` mana pun, langsung pakai itu tanpa cek typo. Ini penting karena bank berisi banyak nama asli yang mirip (Iran/Irak, Slovakia/Slovenia, Kasir/Kusir, Pramugari/Pramugara, Solo/Solok, Nusa Tenggara Barat/Timur).
4. **Toleransi typo (hanya kalau tidak ada yang cocok persis):** jarak Levenshtein 0 untuk kata ≤ 4 huruf (misal "AC", "Pel", "Yak"), ≤ 1 untuk 5–8 huruf, ≤ 2 untuk lebih panjang. Kalau typo cocok ke **lebih dari satu** jawaban dengan jarak yang sama, tanyakan pemain ("Maksudmu Iran atau Irak?").
5. **Cek `sering_salah` dulu:** jawaban yang ada di daftar ini tidak dicocokkan ke apa pun dan langsung ditawarkan ke Sidang Banding.
6. **Konfirmasi di HP:** setelah dicocokkan, HP menampilkan versi resminya ("Kamu menjawab: **Sirsak**") supaya pemain sadar kalau autocorrect salah tebak, lalu bisa membatalkan sebelum mengunci.
7. Seluruh pencocokan dilakukan di **server**. HP tidak pernah menerima daftar jawaban atau tier (anti-curang lewat inspect element).

---

## 7. Layar

### HP pemain
- Prompt besar di atas, input teks besar, tombol **Kirim**.
- Status jawaban: diterima / tidak ditemukan (sisa percobaan) / sedang dibanding.
- Tombol **Kunci Jawaban** dan timer.
- Saat reveal: tampilkan zona yang didapat dan poin ("🌑 Zona Gelap · 1.000 m · +80").

### Big screen
- Lobby mode: judul "Satu Dalam Sejuta", ilustrasi laut, penjelasan aturan singkat (3 baris).
- Saat menjawab: prompt, timer, dan avatar pemain yang berubah jadi penyelam ketika mengunci.
- Sidang Banding: jawaban yang dibanding, nama pengaju, dan status keputusan host.
- Reveal: penampang laut vertikal (Permukaan → Palung) dengan avatar turun ke kedalaman, plus label Tabrakan / Sendirian / Sok Pinter / Mutiara.
- "Yang lebih dalam lagi…": 3 jawaban langka yang terlewat + Mutiara.
- Klasemen kedalaman per prompt dan total.

### Panel host
- Pilih jumlah prompt, pilih prompt manual atau acak, toggle Penyelaman Ganda.
- Saat ronde berjalan: lihat jawaban semua pemain secara live (hanya di panel host), tambah waktu, akhiri fase jawab lebih awal.
- **Antrean banding:** tombol **Sah** + pilih tier (1–5), atau **Tolak**. Opsi "Sah + simpan ke daftar".
- Ubah tier / koreksi jawaban pemain setelah reveal bila ada kesalahan pencocokan (skor dihitung ulang otomatis).
- Editor bank prompt sederhana: tambah/hapus prompt dan jawaban, ubah tier, tandai Sok Pinter / Mutiara, import/export JSON.

---

## 8. Kasus khusus

| Kasus | Perilaku |
|---|---|
| Pemain tidak menjawab sampai waktu habis | 0 poin, avatar "🫧 Ngambang" |
| Pemain terputus saat fase jawab | Jawaban terakhir yang sudah dikirim tetap dihitung; kalau belum ada, 0 |
| Banyak banding sekaligus | Diproses berurutan; fase reveal menunggu antrean banding kosong |
| Host lupa memutus banding | Setelah 30 detik, otomatis **Sah di tier 3** (Zona Senja) supaya game tetap jalan; host bisa koreksi |
| Semua pemain menjawab sama | Semua kena Tabrakan, big screen menampilkan "🧠 Satu otak berenam" |
| Jawaban tidak pantas | Host menolak saat banding; tambahkan filter kata kasar sederhana di server |

---

## 9. Kebutuhan teknis (tambahan ke SPEC.md)

- State per prompt: daftar jawaban pemain, status pencocokan, antrean banding, hasil skor.
- Modul `matcher` di server (normalisasi, alias, cocok-persis-dulu, Levenshtein, `sering_salah`) dengan unit test untuk contoh di §6, termasuk pasangan mirip: Iran/Irak, Slovakia/Slovenia, Solo/Solok, Kasir/Kusir, AC/PC.
- **Sumber data tunggal: `data/prompts.json`** (prompt, jawaban, alias, tier, Mutiara, Sok Pinter, catatan, skoring, sering_salah). Dimuat dan divalidasi saat server start; perubahan dari panel host ditulis balik ke file ini (dengan backup).
- Riwayat prompt yang sudah dipakai disimpan per sesi.
- Animasi penampang laut bisa dibuat dengan CSS (gradient biru → hitam) dan transisi `transform` untuk avatar penyelam; tidak perlu library berat.
- Efek suara: blub, gelembung, "tetot" untuk Sok Pinter, kilau untuk Mutiara.

## 10. Di luar cakupan (versi ini)
- Mode harian/solo seperti Krillion asli, akun, streak, dan fitur share ke media sosial.
- Penentuan kelangkaan otomatis berbasis data frekuensi kata; tier cukup dikurasi manual.
- Mode multiplayer antar-squad.

## 11. Urutan build
1. Muat & validasi `data/prompts.json` + modul matcher + unit test.
2. Loop inti: prompt → jawab → kunci → skor (tanpa banding, tanpa animasi).
3. Sidang Banding di panel host dan big screen.
4. Reveal penampang laut, modifier (Tabrakan, Sendirian, Sok Pinter, Mutiara), "Yang lebih dalam lagi…".
5. Editor bank prompt di panel host (baca/tulis `data/prompts.json`).
6. Integrasi ke leaderboard event, gelar akhir, dan pemilihan urutan mode per sesi.
7. Dry run dengan 3–4 orang: cek apakah banding terlalu sering (kalau iya, tambah jawaban ke `data/prompts.json`).

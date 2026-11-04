# Rancangan Sistem Manajemen Stok & Gudang (WMS)

Oct 31, 2026 · @Paduka

## 1. Ringkasan & tujuan

Sistem ini adalah aplikasi web untuk mengelola stok, gudang, dan QC dalam satu sumber data, dibuat untuk penjual online di marketplace dengan satu gudang yang akan berkembang menjadi beberapa gudang.

**Masalah yang dipecahkan**

- Stok di gudang, spreadsheet, dan marketplace tidak sama, sehingga terjadi oversell dan pembatalan pesanan.
- Barang masuk tanpa pemeriksaan kualitas yang tercatat, sehingga barang cacat ikut terjual.
- Barang retur tidak jelas nasibnya: dijual lagi, diperbaiki, atau dibuang.
- Tidak ada jejak batch dan tanggal kedaluwarsa, sehingga recall dan FEFO sulit dilakukan.

**Sasaran utama**

1. Akurasi stok di atas 99% lewat pencatatan setiap pergerakan barang.
2. Semua barang masuk melewati QC sebelum dapat dijual.
3. Pesanan marketplace masuk otomatis dan stok tersinkron kembali.
4. Retur ditangani dengan alur yang jelas dan hasilnya masuk kembali ke stok.

**Asumsi**

- Satu gudang saat ini, tetapi seluruh data sudah memakai `warehouse_id` agar mudah menambah gudang.
- Pengguna utama bekerja dari laptop (admin) dan HP (staf gudang untuk scan barcode).
- Penjualan utama lewat marketplace; penjualan langsung/offline bersifat tambahan.
- Bahasa antarmuka: Indonesia.

* Marketplace saat ini hanya Shopee, lewat toko milik reseller; marketplace lain menyusul.
* Sekitar 100 produk (jumlah varian bisa jauh lebih banyak), lebih dari 10 reseller, hingga sekitar 100 resi per hari, dan satu staf gudang (Anda sendiri, merangkap petugas QC).
* Produk saat ini topi tanpa kedaluwarsa; fitur batch dan expiry disiapkan untuk produk makanan di kemudian hari.
* Printer thermal sudah ada; scan lewat kamera HP.

## 2. Peran pengguna & hak akses

Akses dibatasi per peran (RBAC) dan per gudang, sehingga staf hanya melihat dan mengubah data yang menjadi tugasnya.

| Peran | Tugas utama | Akses |
| --- | --- | --- |
| Admin | Kelola pengguna, master data, pengaturan | Semua modul |
| Kepala gudang | Setujui penyesuaian stok, opname, pindah lokasi | Gudang, stok, laporan |
| Staf gudang | Terima barang, picking, packing, scan | Penerimaan, stok, pengiriman (via HP) |
| Petugas QC | Periksa barang masuk, retur, dan paket (QC packing); tentukan disposisi | Modul QC dan retur |
| Purchasing | Buat PO, kelola pemasok | Pemasok, PO, penerimaan (lihat) |
| Online ops / CS | Pantau pesanan marketplace, proses retur | Sales order, retur |
| Manajemen | Pantau kinerja | Dashboard dan laporan (baca saja) |
| Reseller | Unggah resi dan order, pantau checklist paket, update hasil kirim | Portal terbatas: order sendiri, stok tersedia (baca saja), update hasil kirim, tagihan, dan unggah bukti bayar |

## 3. Modul & fitur

Sistem terdiri dari 14 modul. Fase 1 (MVP) mencakup modul 1–7 dan 12, serta dasar modul 13 dan 14; sisanya menyusul sesuai roadmap.

| # | Modul | Fitur utama | Fase |
| --- | --- | --- | --- |
| 1 | Master produk | SKU, varian (warna/ukuran), kategori, satuan, barcode, foto, harga beli/jual, stok minimum, penanda wajib batch/expiry, pemetaan SKU ke listing marketplace | 1 |
| 2 | Gudang & lokasi | Gudang, zona, rak, bin; lokasi khusus: Karantina (menunggu QC), Retur, Reject | 1 |
| 3 | Stok | Stok per lokasi/batch, stok tersedia vs dipesan (reserved), kartu stok, riwayat pergerakan, transfer lokasi, penyesuaian dengan alasan | 1 |
| 4 | Penerimaan barang (inbound) | Terima berdasar PO atau tanpa PO, scan barang, catat selisih jumlah, barang otomatis masuk Karantina | 1 |
| 5 | QC | Checklist per kategori produk, sampling, hasil Lulus / Gagal / Lulus bersyarat, foto bukti, catatan cacat, disposisi (terima, retur ke pemasok, reject) | 1 |
| 6 | Purchase order | Pemasok, PO, persetujuan, status (draft, dikirim, sebagian, selesai), riwayat harga beli | 1 |
| 7 | Sales order & pengiriman | Pesanan marketplace, reservasi stok, picking list, packing, scan validasi, cetak label/resi, status kirim | 1 |
| 8 | Retur | Terima retur dari pelanggan, inspeksi, disposisi: jual lagi / perbaiki / reject / kembali ke pemasok, alasan retur, refund tertaut | 2 |
| 9 | Batch & expiry | Nomor batch, tanggal kedaluwarsa, aturan FEFO saat picking, peringatan hampir kedaluwarsa, penelusuran recall | 2 |
| 10 | Barcode / QR | Cetak label barcode/QR untuk produk dan lokasi, scan lewat kamera HP untuk terima, pindah, picking, opname | 1–2 |
| 11 | Dashboard & laporan | Stok menipis, nilai persediaan, perputaran, produk lambat laku, tingkat lulus QC, tingkat retur per produk/pemasok, kinerja pemasok | 2 |
| 12 | Reseller, resi & verifikasi packing | Portal reseller dengan unggah resi, checklist status paket, reservasi stok otomatis, cetak resi, scan packing (resi lalu barang) dengan blokir salah barang, QC packing, serah terima kurir, pencatatan insiden salah kirim | 1 |
| 13 | COD & konfirmasi uang | Penanda COD dari resi, nominal, status uang (menunggu, lunas, selisih, tidak ada tagihan), jumlah dan tanggal diterima, catatan selisih, ekspor Excel; rekonsiliasi dengan laporan pencairan (impor Excel) menyusul | 1 (dasar), 2 |
| 14 | Penagihan reseller | Harga per SKU untuk reseller, tagihan bulanan dari resi sukses (status diperbarui reseller), status tagihan (draft, terbit, dibayar sebagian, lunas, terlambat), catat pembayaran dan bukti, kredit nota dari retur, saldo dan umur piutang, portal tagihan, ekspor Excel; pengingat otomatis dan batas piutang menyusul | 1 (dasar), 2 |

**Fitur tambahan yang saya sarankan**

- **Stock opname terjadwal**: hitung per rak atau cycle count, selisih disetujui kepala gudang.
- **Notifikasi**: stok di bawah minimum, barang hampir kedaluwarsa, PO terlambat (email atau WhatsApp).
- **Rekomendasi restock**: dari kecepatan penjualan dan lead time pemasok.
- **Skor pemasok**: dari persentase lulus QC, ketepatan waktu, dan harga.
- **Bundling/kit**: satu SKU jual yang terdiri dari beberapa SKU gudang.
- **Log audit**: siapa mengubah apa dan kapan, tidak bisa dihapus.
- **Impor/ekspor Excel**: migrasi data awal dan laporan untuk akuntansi.
- **Saran lokasi simpan (putaway)**: otomatis menyarankan bin kosong terdekat.

## 4. Fitur prioritas: alur reseller dan resi

Reseller mengunggah resi langsung ke sistem, lalu setiap paket berjalan dalam satu alur dengan checklist status: packing, QC packing, pengurangan stok, dan serah terima ke ekspedisi. Stok tidak lagi dicatat manual setelah packing.

Alur sekarang (reseller jual, resi dikirim ke Anda, cetak, catat manual, packing, serahkan ke ekspedisi) punya dua celah: pencatatan stok bergantung pada ingatan, dan tidak ada pemeriksaan barang yang diambil.

&#91;embedded content: checklist per paket · 8 langkah, 1 pemotongan stok\]

**Checklist per paket**

Reseller dan gudang melihat checklist yang sama; reseller hanya bisa membaca, dan menerima pemberitahuan setiap status berubah.

| Langkah | Pelaku | Syarat lanjut | Efek ke stok |
| --- | --- | --- | --- |
| 1. Resi diunggah | Reseller | Nomor resi unik; SKU dan jumlah terisi; nominal COD diisi bila paket COD | Belum ada |
| 2. Stok dipesan | Otomatis | Stok tersedia cukup; bila tidak, order ditolak dan reseller diberi tahu | Stok tersedia berkurang, stok fisik tetap |
| 3. Resi dicetak | Staf gudang | Dicetak dari antrean; daftar picking dibuat | Tidak ada |
| 4. Picking | Staf gudang | Ambil barang sesuai lokasi rak | Tidak ada |
| 5. Packing | Staf gudang | Scan resi lalu tiap barang; salah barang atau jumlah diblokir | Tidak ada |
| 6. QC packing | Petugas QC | Isi paket cocok dengan resi per SKU dan jumlah; tipe packing dipilih (plastik, bubble wrap, kardus, atau lainnya). Bila gagal, paket kembali ke packing dengan catatan penyebab | Tidak ada |
| 7. Stok terpotong | Otomatis | QC packing lolos | Stok fisik berkurang, tercatat di ledger |
| 8. Diserahkan ke ekspedisi | Staf gudang | Scan resi saat serah terima; hanya paket berstatus stok terpotong yang bisa dipindai | Tidak ada |

Setelah langkah 8, reseller memperbarui hasil kirim di portal (kapan saja, paling lambat 7 hari setelah diserahkan): sukses, gagal atau retur, atau batal. Hasil ini menjadi dasar tagihan bulanan (use case 9) dan status uang COD (use case 8).

**Masalah saat ini dan pengamannya**

| Masalah | Pengaman di sistem |
| --- | --- |
| Barang sudah dibawa kurir, stok belum dicatat | Stok terpotong otomatis setelah QC packing lolos, dan serah terima hanya menerima paket berstatus stok terpotong. Paket yang belum lolos tidak bisa dipindai keluar. |
| Salah ambil barang, lalu salah kirim | Packing memeriksa resi lalu tiap barang, dan QC packing memeriksa ulang isi paket sebagai lapis kedua. SKU atau jumlah yang tidak cocok diblokir dengan alarm. |
| Paket tertinggal di tengah alur | Dashboard harian memuat paket yang tertahan di tiap status (resi belum dicetak, belum dipacking, lolos QC tetapi belum diserahkan), dengan peringatan di akhir hari. |
| Resi diunggah dua kali | Nomor resi unik per kanal; unggahan kedua ditolak. |
| Reseller membatalkan setelah mengunggah resi | Sebelum packing, reservasi stok dilepas. Setelah packing, perlu persetujuan gudang dan paket masuk antrean retur ke rak. |
| Salah kirim baru ketahuan setelah diserahkan | Insiden dicatat pada order (barang seharusnya dan barang terkirim), stok dikoreksi dengan persetujuan kepala gudang, dan paket yang kembali ditangani lewat modul Retur. |

**Fitur pendukung**

- **Akun reseller**: login terbatas; reseller hanya melihat order dan paketnya sendiri, serta stok tersedia produk yang boleh mereka jual. Reseller tidak bisa mengubah stok.
- **Unggah resi langsung**: file resi (satu file per paket, PDF atau gambar) diunggah bersama SKU dan jumlah lewat form atau impor Excel/CSV, dan beberapa file bisa diunggah sekaligus. Nomor resi dibaca dari barcode label sebagai kunci paket. Contoh label Shopee (SPX) yang Anda kirim memuat teks yang bisa dibaca: nomor resi, nomor pesanan, nama toko pengirim, nama produk, variasi, jumlah, dan batas kirim, sehingga reseller cukup mengunggah file. Kolom SKU pada label itu kosong, jadi produk dicocokkan lewat nama produk dan variasi ke varian internal; pencocokan dibuat sekali per toko dan produk, lalu diingat sistem. Format kurir atau marketplace lain perlu diuji sendiri.
- **Cetak resi dari sistem**: gudang mencetak dari satu antrean, berurutan sesuai daftar picking.
- **QC packing yang bisa diatur**: pemeriksaan intinya kesesuaian isi paket dengan resi per SKU dan jumlah, serta tipe packing (plastik, bubble wrap, kardus, atau lainnya) yang dicatat pada order. Penimbangan tidak dibuat; foto isi paket bisa ditambahkan bila nanti diperlukan.
- **Laporan per reseller**: jumlah paket, tingkat gagal QC packing, tingkat salah kirim dan retur, serta produk terlaris.
- **Sinkron stok ke toko reseller** (fase 2, opsional): bila toko marketplace milik reseller, sinkron otomatis hanya bisa berjalan dengan izin akses dari masing-masing reseller; sebelum itu reseller melihat stok lewat portal.

* **Satu resi, banyak produk**: satu resi bisa berisi beberapa SKU dan jumlah; scan packing dan QC packing memeriksa semuanya.
* **Unggah dan cetak massal**: dengan hingga sekitar 100 resi per hari, resi diunggah banyak sekaligus dan dicetak dalam satu antrean ke printer thermal.
* **Picking per gelombang** (saran): paket dikelompokkan per SKU agar satu putaran di rak mengambil banyak paket, lalu dipisah per resi saat packing. Ini berguna karena packing dikerjakan satu orang.
* **Ekspor Excel**: transaksi, stok, dan laporan bisa diunduh sebagai file Excel.

- **Varian produk**: tiap varian (warna, ukuran) punya SKU dan barcode sendiri. Form reseller memakai pencarian dan pemilih varian, bukan mengetik SKU, untuk menekan salah pilih; impor massal SKU dari Excel disediakan.

* **Batas kirim**: tanggal batas kirim pada label dipakai untuk mengurutkan antrean picking dan memberi peringatan paket yang hampir lewat batas.
* **Cetak label dari file resi**: halaman PDF resi hanya terisi label di bagian atas dan sisanya kosong, jadi sistem memotong area label dan menyesuaikannya ke ukuran label printer thermal.
* **Penanda COD**: paket COD ditandai pada checklist dan serah terima, lalu masuk modul COD untuk memastikan uangnya diterima (use case 8).

- **SKU standar dari gudang**: reseller bebas menamai produk sesuai strategi tokonya, tetapi SKU hanya dibuat gudang. Bila reseller mengisi SKU gudang pada kolom SKU di listing Shopee, SKU itu seharusnya tercetak di label dan dibaca langsung (perlu dipastikan pada contoh label berikutnya). Selama belum diisi, produk dicocokkan lewat nama dan variasi lalu dipetakan sekali ke SKU gudang.

* **Tagihan ke reseller**: resi yang sukses masuk ke tagihan bulanan reseller (modul 14, use case 9).

## 5. Alur kerja utama

Barang hanya menjadi stok tersedia setelah lolos QC; barang retur dari pelanggan melewati pemeriksaan yang sama.

&#91;embedded content: alur barang · 1 keputusan QC, 1 putaran retur\]

Barang gagal QC pindah ke lokasi Reject dan tidak pernah ikut dihitung sebagai stok yang bisa dijual. Retur yang lolos kembali ke rak dan menambah stok tersedia.

- **Barang masuk**: staf membuka PO, scan barang, memasukkan jumlah datang; selisih jumlah dicatat. Barang otomatis masuk Karantina, petugas QC mengisi checklist, lalu hasil Lulus memindahkan barang ke rak (putaway) dan menambah stok tersedia.
- **Penjualan marketplace**: pesanan masuk, stok direservasi, daftar picking dibuat (urut FEFO bila ada expiry), staf scan barang saat packing agar tidak salah kirim, lalu QC packing memeriksa paket dan memotong stok, cetak resi, status pengiriman dikirim balik ke marketplace.
- **Retur**: retur dibuat dari pesanan asal dengan alasan, barang diterima ke lokasi Retur, QC menentukan jual lagi, perbaiki, atau reject, dan hasilnya tercatat per produk untuk laporan tingkat retur.
- **Stock opname**: kepala gudang membuat jadwal hitung per rak, staf scan dan hitung, sistem menampilkan selisih, penyesuaian dibuat setelah disetujui dan tercatat di log audit.

**Diagram alur per use case**

Sembilan use case berikut mencakup seluruh modul. Use case 1 sampai 5 masuk fase 1, use case 8 dan 9 masuk fase 1 untuk pencatatan dasar; use case 6 dan 7 dikerjakan di fase 2.

### Use case 1: pembelian dan penerimaan barang

&#91;embedded content: pembelian dan penerimaan · 1 keputusan QC\]

Selisih jumlah saat scan terima dicatat otomatis; barang yang gagal QC tidak pernah menambah stok tersedia.

### Use case 2: order reseller sampai serah terima kurir

&#91;embedded content: order reseller sampai serah terima · 3 keputusan\]

Barang yang salah tidak bisa lolos packing, dan stok baru berkurang setelah QC packing lolos. Bila reseller membatalkan sebelum packing, reservasi stok dilepas.

### Use case 3: retur pelanggan

&#91;embedded content: retur pelanggan · 3 disposisi\]

Barang yang diperbaiki diperiksa ulang sebelum boleh dijual. Alasan dan hasil disposisi tercatat per produk untuk laporan tingkat retur.

### Use case 4: stock opname dan penyesuaian stok

&#91;embedded content: stock opname · 2 keputusan\]

Penyesuaian selalu dicatat sebagai pergerakan baru di ledger, bukan mengubah angka lama, sehingga setiap koreksi bisa ditelusuri.

### Use case 5: salah kirim

&#91;embedded content: penanganan salah kirim · 1 keputusan\]

Bila paket masih di gudang, cukup ditahan dan dipacking ulang. Bila sudah diserahkan, barang yang sebenarnya keluar dikoreksi di stok dan paket yang salah masuk lewat alur retur.

### Use case 6: sinkron stok ke marketplace (fase 2)

&#91;embedded content: sinkron stok ke marketplace · fase 2\]

Setiap perubahan stok tersedia mendorong angka baru ke semua listing yang tertaut. Jumlah yang dikirim sudah dikurangi stok pengaman untuk mencegah oversell.

### Use case 7: batch, kedaluwarsa, dan recall (fase 2)

&#91;embedded content: batch, expiry, recall · fase 2\]

Berlaku untuk produk yang diberi tanda wajib batch atau expiry. Dari satu batch, sistem bisa menunjukkan semua order yang menerima batch itu.

### Use case 8: COD dan konfirmasi uang diterima

&#91;embedded content: COD dan konfirmasi uang · 2 keputusan\]

Setiap paket COD punya status uang sendiri: menunggu, lunas, selisih, atau tidak ada tagihan (retur atau gagal kirim). Fase 1 mencatat status dan jumlah yang diterima secara manual; mencocokkannya otomatis dengan laporan pencairan menyusul di fase 2.

### Use case 9: penagihan ke reseller

&#91;embedded content: penagihan ke reseller · 1 keputusan\]

Uang COD masuk ke saldo Shopee reseller, jadi Anda menagih reseller. Tagihan dibuat sebulan sekali dan hanya memuat resi yang sukses (diterima pembeli), dihitung dari harga SKU yang sama untuk semua reseller; paket retur atau gagal tidak ditagih. Retur yang masuk setelah tagihan terbit mengurangi tagihan bulan berikutnya lewat kredit nota, dan resi yang statusnya baru diperbarui setelah tutup bulan ikut tagihan bulan berikutnya. Jatuh tempo tagihan maksimal 7 hari setelah terbit.

**Isi modul penagihan**

- **Harga reseller per SKU**: satu harga gudang per SKU, sama untuk semua reseller. Reseller bebas menentukan harga jual di tokonya sendiri.
- **Komponen tagihan**: harga barang kali jumlah, biaya tambahan per paket (misalnya packing) sebagai fitur opsional yang dinyalakan di pengaturan dan mati secara bawaan, kredit retur, dan penyesuaian manual dengan alasan.
- **Status tagihan**: draft, terbit, dibayar sebagian, lunas, terlambat, dan dibatalkan; besaran tagihan, yang sudah dibayar, dan sisa tampil per tagihan.
- **Pembayaran**: catat tanggal, jumlah, metode, dan bukti transfer; satu pembayaran bisa melunasi beberapa tagihan.
- **Saldo piutang per reseller** dan umur piutang (belum jatuh tempo, 1 sampai 30 hari, lebih dari 30 hari).
- **Portal reseller**: lihat tagihan dan statusnya, unduh PDF, dan unggah bukti bayar.
- **Ekspor Excel**: tagihan, pembayaran, dan piutang.

* **Periode dan dasar tagihan**: bulanan, hanya untuk resi berstatus sukses. Status sukses diperbarui reseller di portal setelah paket diserahkan (sukses, gagal atau retur, batal), kapan saja sampai 7 hari sejak diserahkan. Jatuh tempo tagihan maksimal 7 hari sejak terbit.

- **Pengaman status dari reseller** (saran): status gagal harus cocok dengan paket retur yang benar-benar diterima di gudang, bila tidak ditandai untuk diperiksa; reseller mengunggah tangkapan layar status Shopee sebagai bukti; resi yang belum diperbarui setelah 7 hari sejak diserahkan masuk daftar tinjauan, tidak otomatis ditagih atau dibebaskan; setiap perubahan status tercatat di log audit.

**Opsi tambahan yang saya sarankan**

- **Pengingat otomatis** lewat WhatsApp atau email sebelum dan sesudah jatuh tempo.
- **Batas piutang per reseller**: peringatan, atau order baru ditahan sampai tagihan dibayar.
- **Saldo prabayar**: reseller mengisi saldo dan tagihan memotongnya otomatis, sehingga piutang berkurang.
- **Harga bertingkat**: harga lebih rendah untuk reseller dengan volume tertentu.
- **Laporan margin per reseller**: selisih harga reseller dan harga beli.

## 6. Rancangan database

Prinsip utamanya: **stok tidak pernah diubah langsung**. Setiap perubahan dicatat sebagai baris di ledger pergerakan stok (`stock_movements`), dan saldo stok dihitung atau di-cache dari ledger itu. Dengan begitu setiap selisih bisa ditelusuri.

| Kelompok | Tabel inti | Isi dan relasi penting |
| --- | --- | --- |
| Pengguna | `users`, `roles`, `user_warehouses` | Peran dan gudang yang boleh diakses |
| Produk | `products`, `product_variants`, `categories`, `uom`, `marketplace_listings` | Satu produk punya banyak varian; satu SKU bisa tertaut ke banyak listing marketplace |
| Gudang | `warehouses`, `locations` | Lokasi punya tipe: storage, quarantine, return, reject |
| Stok | `batches`, `stock_balances`, `stock_movements`, `stock_reservations` | Saldo per varian + lokasi + batch; ledger bersifat append-only |
| Pembelian | `suppliers`, `purchase_orders`, `po_items`, `goods_receipts`, `receipt_items` | Penerimaan bisa sebagian dari satu PO |
| QC | `qc_templates`, `qc_inspections`, `qc_results`, `qc_defects` | Inspeksi tertaut ke penerimaan atau retur; hasil menentukan perpindahan dari Karantina |
| Penjualan | `sales_orders`, `so_items`, `pick_lists`, `shipments` | Pesanan dari marketplace membawa `channel` dan `external_order_id` |
| Retur | `returns`, `return_items`, `return_dispositions` | Tertaut ke sales order asal dan hasil QC retur |
| Audit | `audit_logs`, `stock_adjustments`, `stocktakes` | Siapa, kapan, nilai sebelum dan sesudah |
| COD | cod\_payments | Satu baris per paket COD: nominal, status uang, jumlah dan tanggal diterima, catatan selisih; tertaut ke sales order dan retur |
| Penagihan | reseller\_prices, invoices, invoice\_items, payments, credit\_notes | Harga per SKU per reseller; satu tagihan memuat banyak paket; pembayaran dialokasikan ke tagihan; kredit nota berasal dari retur |

**Aturan data**

- Hampir semua tabel membawa `warehouse_id`, sehingga multi-gudang tidak butuh perombakan.
- Jenis pergerakan: `receipt`, `qc_release`, `putaway`, `transfer`, `reserve`, `pick`, `ship`, `return_in`, `adjust`, `scrap`.
- Stok tersedia = saldo di lokasi bertipe storage dikurangi reservasi. Barang di Karantina, Retur, dan Reject tidak pernah dihitung tersedia.
- Perubahan saldo dan ledger dilakukan dalam satu transaksi database agar tidak pernah tidak sinkron.
- Gunakan `numeric` untuk harga dan jumlah, bukan float; simpan waktu dalam UTC.

* Pencocokan produk pada resi disimpan di `listing_mappings`: (toko pengirim, nama produk, variasi) menjadi varian internal, dibuat sekali lalu dipakai ulang.
* Order menyimpan nomor resi, nomor pesanan marketplace, toko pengirim, batas kirim, dan penanda COD.

## 7. Arsitektur & tech stack

Satu aplikasi Next.js dengan PostgreSQL sebagai pusat data sudah cukup untuk satu gudang, dan mudah dikembangkan ke banyak gudang.

&#91;embedded content: arsitektur sistem · 4 lapisan\]

Pekerjaan berat seperti sinkron marketplace dijalankan worker lewat antrean, sehingga layar staf gudang tidak ikut lambat. Worker menarik pesanan dari marketplace dan mendorong angka stok ke sana.

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Aplikasi | Next.js (App Router) + TypeScript | Satu codebase dari tampilan sampai API, tipe data aman |
| Tampilan | Tailwind CSS, shadcn/ui, TanStack Table | Form dan tabel besar cepat dibuat |
| Database | PostgreSQL + Prisma atau Drizzle | Transaksi dan penguncian baris untuk reservasi stok |
| Autentikasi | Auth.js atau Better Auth | Login, sesi, dan hak akses per peran |
| Job | BullMQ + Redis | Sinkron marketplace dengan percobaan ulang |
| Scan | Pustaka scanner kamera di browser (mis. ZXing), PWA | Tanpa aplikasi native |
| File | Penyimpanan kompatibel S3 (S3, R2, MinIO) | Foto QC dan lampiran |
| Deploy | Development dan produksi di cloud: aplikasi di Vercel, PostgreSQL terkelola, serta worker dan Redis di layanan terpisah (mis. Railway, Fly.io, atau Render) | Vercel tidak cocok untuk worker yang berjalan terus |
| Pengujian | Vitest, Playwright | Menguji alur stok dari ujung ke ujung |

**Kesiapan multi-gudang**

- Menambah gudang berarti menambah data, bukan mengubah skema, karena semua tabel sudah memakai `warehouse_id`.
- Transfer antar gudang memakai dokumen transfer dengan status dalam perjalanan dan diterima.
- Bila data membesar, partisi `stock_movements` per bulan dan beri indeks pada varian, lokasi, dan waktu.
- Kode dipisah per domain (stok, QC, order, retur) dalam satu monolit modular, sehingga bisa dipecah kelak bila perlu.

## 8. Integrasi marketplace & barcode

Gudang ini menjadi sumber kebenaran stok; marketplace hanya menerima angka stok dari sistem.

**Marketplace**

- **Pesanan masuk**: sistem menarik pesanan baru dari API marketplace (webhook bila tersedia, polling berkala sebagai cadangan), lalu otomatis mereservasi stok.
- **Stok keluar**: setiap perubahan stok tersedia mendorong angka baru ke semua listing yang tertaut, lewat antrean job dengan percobaan ulang.
- **Pencegahan oversell**: kirim stok dikurangi stok pengaman (misalnya 2 unit), dan reservasi dilakukan dalam transaksi database dengan penguncian baris.
- **Idempotensi**: `external_order_id` unik per kanal, sehingga pesanan yang sama tidak diproses dua kali.
- **Tahap awal**: impor pesanan lewat file Excel/CSV dari seller center sebagai jalan cepat, lalu API resmi, dimulai dari Shopee dan disusul marketplace lain (Tokopedia/TikTok Shop, Lazada). Ketersediaan dan syarat API perlu dicek per marketplace saat tahap integrasi.
- **Alternatif**: bila ingin mempercepat, pertimbangkan agregator marketplace sebagai penghubung, dengan biaya langganan.

**Barcode / QR**

- Setiap varian punya barcode (EAN-13 bila sudah ada, atau kode internal Code128); setiap lokasi punya QR.
- Scan lewat kamera HP di browser (aplikasi web responsif/PWA), tanpa perangkat khusus. Scanner USB/Bluetooth juga didukung karena bekerja sebagai keyboard.
- Titik scan: terima barang, putaway, picking, packing (validasi barang sesuai pesanan), retur, dan opname.
- Label dicetak dari sistem ke printer thermal (barcode produk, label lokasi, label batch).

## 9. Keamanan, audit & backup

- **Login**: email + kata sandi (hash argon2/bcrypt), opsional 2FA untuk admin dan kepala gudang; sesi dengan masa berlaku.
- **Otorisasi**: pengecekan peran dan gudang di sisi server pada setiap permintaan, bukan hanya menyembunyikan tombol di layar.
- **Audit**: semua perubahan data penting dan penyesuaian stok tercatat (siapa, kapan, sebelum, sesudah); ledger stok tidak bisa diedit atau dihapus, koreksi dibuat sebagai pergerakan baru.
- **Persetujuan**: penyesuaian stok di atas ambang tertentu butuh persetujuan kepala gudang.
- **Kredensial marketplace**: token API disimpan terenkripsi, tidak pernah tampil di antarmuka.
- **Transportasi & input**: HTTPS wajib, validasi input di server, perlindungan CSRF dan pembatasan percobaan login.
- **Backup**: backup database otomatis harian dengan pemulihan titik waktu (PITR) bila memakai PostgreSQL terkelola; uji pemulihan minimal tiap kuartal.
- **Pemantauan**: pelacakan error dan alarm untuk job sinkronisasi yang gagal.

* **Data penerima**: resi memuat nama, alamat, dan nomor telepon penerima. Simpan hanya yang diperlukan, batasi tampilannya per peran (staf gudang dan reseller pemilik order), dan samarkan atau hapus setelah periode tertentu.

## 10. Roadmap bertahap

Bangun fondasi stok dan QC lebih dulu, baru sambungkan marketplace lewat API; urutan ini mengurangi risiko karena data stok sudah benar sebelum disinkronkan keluar.

&#91;embedded content: roadmap · 3 fase, 2 gerbang\]

Lama tiap fase belum ditetapkan; ini bergantung pada ukuran tim pengembang dan jawaban atas pertanyaan terbuka di bagian 11. Pada fase 1 order masuk lewat unggahan resi dari reseller (dan impor Excel/CSV), sehingga gudang sudah bisa bekerja dengan sistem baru tanpa menunggu integrasi API Shopee.

## 11. Risiko & pertanyaan terbuka

**Risiko**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| API marketplace berubah atau dibatasi | Sinkron stok/pesanan terganggu | Lapisan adapter per kanal, impor CSV sebagai cadangan |
| Staf tidak disiplin scan | Stok tidak akurat | Alur wajib scan, opname rutin, pelatihan singkat |
| Data awal berantakan | Migrasi lambat | Template impor Excel, opname awal sebelum go-live |
| Cakupan terlalu besar di awal | MVP terlambat | Fase 1 hanya modul 1–7 dan 12, sisanya bertahap |
| Sinyal internet gudang lemah | Scan gagal | PWA dengan antrean offline sederhana (fase 2) |
| Reseller salah memilih varian | Salah kirim varian | Pemilih varian di form, lalu scan packing dan QC packing mencocokkan varian dengan resi |

**Jawaban Anda dan dampaknya pada rancangan**

| Hal | Jawaban Anda | Dampak pada rancangan |
| --- | --- | --- |
| Marketplace | Saat ini hanya Shopee, akan bertambah | Kanal dibuat generik sejak awal; Shopee lebih dulu, marketplace lain tinggal menambah adapter |
| Jumlah SKU | Sekitar 100 produk | Skala kecil, termasuk dengan banyak varian; PostgreSQL biasa lebih dari cukup |
| Staf gudang | Satu orang, akan bertambah | Layar scan dibuat ringkas untuk satu orang; hak akses per peran siap untuk staf tambahan |
| Kedaluwarsa | Tidak ada (topi), mungkin makanan nanti | Batch dan expiry dinyalakan per produk dan dikerjakan di fase 2 (use case 7) |
| Akuntansi | Belum ada; ingin data transaksi bisa diekspor ke Excel | Tanpa integrasi akuntansi; ekspor Excel untuk transaksi, stok, dan laporan masuk fase 1 |
| Perangkat | Printer thermal sudah ada; scan lewat HP | Cetak label thermal dan scan kamera HP (PWA); tidak perlu scanner khusus |
| Pembangun | Anda sendiri | Dirancang agar bisa dirawat satu orang: satu codebase Next.js, layanan terkelola untuk database dan file, sedikit komponen terpisah |
| Hosting | Vercel untuk development, produksi di cloud | Produksi di cloud terkelola; worker tetap berjalan terpisah dari Vercel |
| Reseller dan volume | Lebih dari 10 reseller, hingga sekitar 100 resi per hari | Unggah dan cetak massal serta picking per gelombang masuk fase 1 |
| Peran reseller | Hanya mengirim resi; packing dan pengiriman Anda yang urus; boleh melihat stok dan order | Akun reseller terbatas: unggah resi, lihat stok tersedia dan status order sendiri |
| Isi resi | Satu resi bisa berisi beberapa produk | Order punya banyak baris item; scan packing memeriksa semuanya |
| Petugas QC | Sementara Anda sendiri | Satu pengguna boleh memegang beberapa peran; QC packing tetap langkah tersendiri dan bisa diserahkan ke orang lain tanpa mengubah alur |
| Isi QC packing | Kesesuaian barang dengan resi per SKU, dan tipe packing; tidak perlu ditimbang | Checklist: SKU dan jumlah cocok, serta tipe packing (plastik, bubble wrap, kardus, lainnya); tanpa penimbangan |
| Varian produk | Jumlah SKU bisa jauh lebih banyak dari 100 produk | Master produk berbasis varian (warna, ukuran) dengan barcode per varian, impor massal dari Excel, dan pemilih varian di form reseller agar tidak salah SKU |
| File resi Shopee | Diunduh per paket | Satu file diproses sebagai satu paket, sehingga lebih mudah dibaca; unggah massal berarti banyak file sekaligus |
| QC packing terpisah | Iya, QC packing dibuat terpisah dari packing | Alur tidak berubah: scan packing lalu QC packing, dengan pemeriksa yang sama untuk sementara |
| Ukuran label | Sewajarnya | Ukuran label bisa diatur; bawaan mengikuti ukuran resi umum (mis. 100 x 150 mm) dan diuji dengan printer Anda |
| Contoh resi Shopee | Label SPX per paket, kolom SKU kosong, ada penanda COD | Pembacaan otomatis masuk fase 1: nomor resi, nomor pesanan, toko pengirim, jumlah, dan batas kirim diambil dari teks PDF; produk dicocokkan lewat nama produk dan variasi |
| Nama produk dan SKU | Nama produk bebas per reseller; SKU standar dari gudang | SKU gudang menjadi satu-satunya kunci produk; nama listing tiap toko dipetakan ke SKU itu, dan reseller diminta mengisi SKU gudang pada listing agar pencocokan otomatis |
| COD | Perlu fitur sendiri untuk memastikan uang diterima | Modul 13 (COD & konfirmasi uang) dan use case 8 |
| Contoh resi lain | Belum bisa diberikan | Pembacaan dibuat untuk format yang sudah ada dan diuji bertahap bila contoh baru tersedia |
| Uang COD | Diterima reseller, dan Anda menagih ke reseller | Modul 14 (penagihan reseller) dan use case 9; status uang COD menjadi salah satu dasar waktu menagih |
| Harga SKU untuk reseller | Sama untuk semua reseller; reseller bebas menentukan harga jual | Satu harga per SKU di gudang, tanpa harga per reseller |
| Periode tagihan | Bulanan, berdasarkan resi sukses | Tagihan dibuat sebulan sekali dari resi berstatus sukses; paket retur atau gagal tidak ditagih; retur susulan menjadi kredit nota bulan berikutnya |
| Nominal COD | Diunggah oleh reseller | Nominal COD menjadi isian saat reseller mengunggah resi COD |
| Status sukses | Diperbarui reseller di sistem | Portal reseller punya aksi update hasil kirim, dilengkapi pengaman: bukti, pencocokan dengan retur fisik, dan daftar tinjauan setelah batas 7 hari |
| Biaya tambahan per paket | Dijadikan fitur opsional | Pengaturan untuk menyalakan dan menentukan nominal; bawaan mati |
| Jatuh tempo tagihan | Maksimal satu minggu | Jatuh tempo 7 hari sejak tagihan terbit; status terlambat dan pengingat mengikuti tanggal ini |
| Batas update hasil kirim | Setiap saat, maksimal 1 minggu (saya baca: sejak paket diserahkan) | Reseller bisa memperbarui kapan saja sampai 7 hari sejak paket diserahkan, lalu status terkunci; resi yang baru diperbarui setelah tutup bulan masuk tagihan bulan berikutnya |

**Pertanyaan yang masih terbuka**

- [ ] Bukti tangkapan layar status Shopee: wajib untuk semua status, atau hanya untuk status gagal?
- [ ] Bila lewat 7 hari paket belum diperbarui reseller, apa yang terjadi: dianggap sukses otomatis, atau masuk daftar tinjauan Anda untuk diputuskan?

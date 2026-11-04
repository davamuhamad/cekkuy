# Cekkuy

Fondasi MVP sistem manajemen stok dan gudang sesuai [rancangan](./Rancangan%20Sistem%20Manajemen%20Stok%20%26%20Gudang.md). Aplikasi menggunakan Next.js, TypeScript, PostgreSQL, dan Drizzle ORM.

## Menjalankan aplikasi

1. Gunakan Node.js 20.9 atau lebih baru.
2. Salin `.env.example` menjadi `.env`, lalu sesuaikan `DATABASE_URL` dengan PostgreSQL Anda. URL-encode karakter khusus dalam username/password (contoh: `#` menjadi `%23`, `@` menjadi `%40`, dan `%` menjadi `%25`); jangan membagikan atau menyimpan kredensial asli di `.env.example`.
3. Pasang dependensi dan siapkan skema:

   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   ```

4. Buat akun administrator pertama dan gudang dasar. Masukkan kata sandi secara tersembunyi, jangan menaruhnya di file atau argumen perintah:

   ```bash
   read -rp "Nama admin: " ADMIN_NAME
   read -rp "Email admin: " ADMIN_EMAIL
   read -rsp "Kata sandi admin (min. 12 karakter): " ADMIN_PASSWORD
   echo
   export ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
   npm run db:bootstrap
   unset ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
   ```

5. Jalankan server pengembangan:

   ```bash
   npm run dev
   ```

Buka <http://localhost:3000>. `npm run db:migrate` memeriksa koneksi PostgreSQL dengan batas waktu 10 detik, lalu menjalankan migrasi dan menampilkan statusnya. Untuk Supabase dari jaringan yang tidak memiliki IPv6, gunakan URL **Session Pooler** berkemampuan IPv4 dari menu Connect di dashboard Supabase. `npm test` menjalankan tes unit; `npm run typecheck` memeriksa tipe TypeScript; `npm run build` membuat build produksi.

## Cakupan fondasi

- Dashboard berbahasa Indonesia dengan ringkasan stok dan daftar varian aktif.
- Login dengan session database, cookie HttpOnly/SameSite, pembatasan percobaan masuk, dan role guard di server.
- Master data produk/kategori dengan banyak varian SKU, harga, barcode, dan stok minimum.
- Tampilan persediaan fisik/dipesan/tersedia; admin atau kepala gudang dapat membuat penyesuaian masuk/keluar dengan alasan.
- Stock opname per lokasi dengan snapshot saldo, input jumlah fisik, penguncian pergerakan lokasi, pemeriksaan persetujuan terpisah, dan pencatatan selisih melalui ledger.
- Purchase order dengan penerimaan sebagian atau penuh; barang masuk ke Karantina, inspeksi QC mencatat hasil/catatan, barang lulus masuk ke storage dan barang gagal ke Reject.
- Pesanan reseller/manual dengan reservasi stok atomik, pemindaian SKU/barcode, QC packing, pemotongan ledger setelah QC lulus, dan serah-terima kurir yang mencocokkan resi.
- Portal reseller untuk memasukkan pesanan, memperbarui hasil pengiriman maksimal tujuh hari setelah serah-terima, melihat invoice dan mencatat pembayaran/COD.
- Tagihan bulanan berdasarkan pesanan yang dinyatakan sukses, dengan pencatatan pembayaran, status COD, dan audit aktivitas.
- Bootstrap satu kali untuk membuat admin pertama, gudang, lokasi Karantina/Retur/Reject, dan rak penyimpanan.
- Skema PostgreSQL untuk pengguna/peran, sesi, gudang/lokasi, kategori/produk/varian, saldo dan pergerakan stok, reservasi, PO, pesanan, penerimaan/QC, pengiriman, tagihan, pembayaran, dan audit.
- Harga serta kuantitas disimpan sebagai `numeric`; semua entitas operasional terkait gudang.
- Pergerakan stok dicatat atomik bersama saldo; migrasi menolak perubahan atau penghapusan ledger stok.

## Batasan MVP

- Integrasi API marketplace dan parsing otomatis PDF/resi belum tersedia; pesanan dimasukkan melalui formulir.
- Batch/expiry, FEFO, transfer antar gudang, ekspor laporan, unggah bukti pembayaran, serta notifikasi belum tersedia.
- Retur pengiriman belum membuat penerimaan fisik otomatis; proses pemeriksaan dan penempatan barang retur masih manual.
- Aplikasi saat ini memakai satu gudang aktif per pengguna dan belum mendukung perpindahan gudang dari antarmuka.

Jalankan migrasi sebelum bootstrap. Siapkan dan pastikan `DATABASE_URL` menunjuk ke database aplikasi yang benar sebelum menjalankan migrasi atau membuat akun awal.

## Alur stock opname

1. Admin, kepala gudang, atau staf gudang membuka **Stock opname** dan memilih satu lokasi.
2. Sistem menyimpan snapshot saldo lokasi; hitung semua SKU yang tampil, termasuk jumlah nol, lalu simpan setiap hasil.
3. Setelah seluruh SKU terisi, kirim sesi untuk ditinjau admin/kepala gudang.
4. Persetujuan menerapkan setiap selisih sebagai pergerakan `adjust` pada ledger stok. Jika pengurangan akan memakai stok yang masih direservasi pesanan, selesaikan pesanan tersebut lebih dahulu.
5. Pergerakan masuk/keluar dan transfer lokasi ditahan sejak sesi dimulai sampai disetujui atau dibatalkan. Opname tidak dapat dimulai saat pesanan di lokasi sedang dipicking.

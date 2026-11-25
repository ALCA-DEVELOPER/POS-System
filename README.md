# KulinerKas (POS & Manajemen Keuangan UMKM F&B)

**KulinerKas** adalah aplikasi web **Progressive Web App (PWA)** berbasis Next.js 15 dan Supabase untuk membantu pemilik usaha kuliner (UMKM F&B) mengelola kasir harian, komposisi resep & HPP, stok bahan baku, pencatatan belanja otomatis lewat scan struk AI, modal usaha, hingga laporan laba rugi dan arus kas dalam satu sistem terintegrasi.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Hak Akses & Peran Tim (RBAC)](#hak-akses--peran-tim-rbac)
- [Arsitektur & Keamanan](#arsitektur--keamanan)
- [Tech Stack](#tech-stack)
- [Struktur Direktori](#struktur-direktori)
- [Skema Database, RPC & Storage](#skema-database-rpc--storage)
- [API Endpoints](#api-endpoints)
- [Instalasi & Setup Lokal](#instalasi--setup-lokal)
- [Skrip NPM](#skrip-npm)
- [Catatan Deployment](#catatan-deployment)

---

## Fitur Utama

### 1. Kasir POS (`/pos`) & Riwayat Transaksi (`/pos/riwayat`)
- **Siap Transaksi Langsung**: Layar kasir terbuka tanpa gerbang modal awal shift wajib; shift kasir dibuat otomatis (`open_cashier_shift`) saat transaksi pertama dicatat.
- **Tipe Pesanan & Kalkulasi Otomatis**: Mendukung pesanan *Makan di Tempat* (`dine_in`), *Bungkus / Takeaway* (`takeaway`), dan *Online* (`online`, seperti GoFood/GrabFood), lengkap dengan diskon (`Rp` atau `%`), pajak PB1 default, dan biaya servis.
- **3 Metode Pembayaran**:
  - **Tunai**: Tombol cepat *Uang Pas* dan nominal pecahan Rupiah, plus perhitungan kembalian otomatis.
  - **QRIS Statis**: Menampilkan QRIS toko dan dilengkapi mode **Perbesar QRIS (Layar Penuh)** berlatar putih solid agar mudah dipindai kamera pelanggan dari jarak meja kasir.
  - **Transfer Bank**: Menampilkan nama bank, nomor rekening, atas nama, dan tombol salin cepat.
- **Potong Stok & Hitung HPP Otomatis**: Setiap order memanggil RPC atomik `create_pos_order` untuk memotong stok bahan baku sesuai resep menu, mencatat log `stock_movements`, dan menyimpan `unit_hpp` serta `hpp_total` historis transaksi.
- **Cetak & Kirim Struk (`ReceiptModal`)**:
  - Kirim ringkasan struk ke WhatsApp pelanggan (`wa.me`).
  - Cetak struk via browser print dialog.
  - Cetak langsung ke **Printer Thermal Bluetooth 58mm / 80mm (ESC/POS)** melalui Web Bluetooth API (`src/lib/printer/escpos.ts`).
- **Pembatalan / Hapus Riwayat Transaksi**: Owner dapat menghapus transaksi salah input via `DELETE /api/orders/[id]`, yang otomatis mengembalikan stok bahan baku dan menyesuaikan rekap kas shift.

### 2. Beranda Keuangan (`/dashboard`)
- **Saldo Kas Aktual Usaha**: Menghitung posisi kas real-time berdasarkan rumus:
  `Modal Usaha Bersih + Total Seluruh Penjualan - Total Seluruh Pengeluaran`.
- **Metrik Harian (WIB)**: Pemasukan hari ini, jumlah transaksi, pengeluaran hari ini, laba kotor, laba bersih, dan margin profit (%).
- **Visualisasi Grafik (Recharts)**:
  - Grafik batang perbandingan **Pemasukan vs Pengeluaran Harian** (rentang 7 hari dan 30 hari).
  - Grafik donat **Komposisi Pengeluaran** per kategori dalam 30 hari terakhir.
- **Top 5 Menu Paling Menguntungkan**: Urutan produk berdasarkan kontribusi total laba kotor tertinggi.
- **Peringatan Stok & Kedaluwarsa**: Menampilkan bahan baku dengan stok di bawah minimum atau mendekati/melewati tanggal kedaluwarsa (`<= 7 hari`).

### 3. Scan Struk Belanja AI (`/pengeluaran/scan`) & Daftar Pengeluaran (`/pengeluaran`)
- **OCR Struk Otomatis (Gemini Flash Vision)**: Mengunggah atau memotret struk belanja pasar/supplier (dikompresi lebih dulu di client melalui `src/lib/image-compress.ts`) lalu diekstrak menjadi data terstruktur oleh endpoint `/api/ocr-receipt`.
- **Fallback Model Otomatis**: Mencoba berurutan `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.7-flash`, hingga `gemini-3.5-flash` jika terjadi rate-limit atau gangguan model.
- **Verifikasi & Konversi Satuan ke Stok**: Pengguna dapat meninjau ulang hasil scan, memetakan item ke bahan baku eksisting, serta mengatur **faktor konversi satuan** (misal beli `1 kg` atau `1 dus` dikonversi otomatis ke `gram`/`pcs` di stok).
- **Penyimpanan Atomik & Arsip Struk Privat**: RPC `save_verified_expense` mencatat pengeluaran, detail item, dan menambah stok bahan baku + memperbarui `cost_per_unit` sekaligus. Foto struk disimpan di bucket privat `receipts` dan diakses melalui Signed URL berbatas waktu (`/api/receipt-url`).
- **Hapus Pengeluaran Aman**: `DELETE /api/expenses/[id]` membatalkan penambahan stok terkait dan menghapus arsip foto struk di Storage.

### 4. Stok Bahan Baku & Waste Dapur (`/stok`)
- Kelola daftar bahan baku (`gram`, `ml`, `pcs`, `kg`, `liter`), stok saat ini, batas stok minimum, harga modal per unit (`cost_per_unit`), dan tanggal kedaluwarsa terdekat.
- **Stock Opname / Penyesuaian** (`adjust_ingredient_stock`) untuk mencocokkan stok fisik dengan sistem.
- **Catat Bahan Rusak / Waste** (`record_kitchen_waste`) untuk mengurangi stok terbuang dan mencatat mutasinya di `stock_movements`.

### 5. Menu Jual & Kalkulasi HPP (`/menu`)
- Kelola produk jual (`Makanan`, `Minuman`, `Paket`, `Topping`), status tampil di kasir POS, dan unggah foto menu ke bucket `menu-images`.
- Penyusun komposisi resep per 1 porsi menu (*Bill of Materials*) dengan perhitungan langsung **Estimasi HPP**, **Laba Kotor**, dan **Margin Profit (%)**.

### 6. Modal Usaha & Pantauan Balik Modal (`/modal-usaha`)
- Mencatat setoran modal awal, suntikan dana tambahan (`deposit`), maupun penarikan dana pemilik / prive (`withdrawal`), lengkap dengan tanggal, sumber dana (`Tunai`, `Transfer Bank`, `QRIS`), catatan, edit, dan hapus.
- Dipisahkan dari omzet penjualan agar angka **Laba Rugi (P&L)** tetap murni dari aktivitas jualan, sementara **Saldo Kas Aktual Usaha** dan **Arus Kas** tetap mencerminkan kas masuk/keluar yang sebenarnya.
- Menampilkan **Progres Balik Modal (Break-Even)** berdasarkan rasio akumulasi Laba Bersih usaha terhadap Total Modal Disetor.

### 7. Laporan Keuangan & Ekspor (`/laporan`)
- Filter rentang waktu: *Hari Ini*, *Kemarin*, *7 Hari*, *Bulan Ini*, atau *Pilih Tanggal* kustom.
- **Laba Rugi Sederhana (P&L)**: Memisahkan pembelian kategori `Bahan Baku` agar dihitung lewat HPP porsi saat menu laku terjual (menghindari *double-counting* di laporan laba rugi).
- **Arus Kas & Riwayat**: Menampilkan total kas masuk penjualan, kas keluar belanja, arus kas modal usaha bersih, serta daftar riwayat transaksi periode terkait.
- **Ekspor Multi-Format**:
  - **Excel (`.xlsx`)** melalui `/api/export/excel` (`exceljs`) berisi 4 sheet: *Ringkasan Keuangan*, *Penjualan POS*, *Pengeluaran*, dan *Modal Usaha*.
  - **PDF** melalui `jspdf` + `jspdf-autotable` (`src/lib/export/pdf-report.ts`) dan mode **Cetak** (`window.print()`).

### 8. Pengaturan Bisnis, Manajemen Tim & Hapus Akun (`/pengaturan-bisnis`)
- Mengelola identitas bisnis bersama (`business_id`), upload logo usaha & gambar QRIS (`store-assets` bucket), rekening bank toko, serta tarif pajak PB1 & biaya servis default.
- Manajemen akun staf fleksibel (`/api/staff`, `/api/staff/[id]`): tambah akun anggota tim, ubah nama/no. HP/password, ubah peran (`owner`, `cashier`, `kitchen`), aktif/nonaktifkan, atau hapus anggota tim.
- **Hapus Akun Permanen (`DELETE /api/account`)**: Pemilik utama dapat menghapus seluruh data bisnis (file di Storage `receipts`/`menu-images`/`store-assets`, data tabel transaksi/inventori, akun staf, profil, dan user Supabase Auth) sehingga email dapat didaftarkan ulang dari awal.

### 9. Autentikasi & Progressive Web App (PWA)
- Alur auth lengkap via Supabase Auth: Daftar Bisnis (`/register`), Login (`/login`), Lupa Password (`/lupa-password`), Reset Password (`/reset-password`), dan Callback (`/auth/callback`).
- Konfigurasi PWA (`public/manifest.json`, `@serwist/next`, `src/app/sw.ts`, `InstallPwaBanner.tsx`) lengkap dengan halaman fallback `/offline`.

---

## Hak Akses & Peran Tim (RBAC)

Pembatasan akses diterapkan di level rute (`src/middleware.ts`), pengecekan server session (`src/lib/auth.ts`), API route handlers, dan **PostgreSQL Row Level Security (RLS)** di database:

| Peran | Kode Role | Rute Halaman yang Diizinkan | Batasan Keamanan |
| --- | --- | --- | --- |
| **Owner** | `owner` | Semua halaman (`/dashboard`, `/pos`, `/pos/riwayat`, `/pengeluaran`, `/pengeluaran/scan`, `/stok`, `/laporan`, `/menu`, `/modal-usaha`, `/pengaturan-bisnis`) | Akses penuh data bisnis milik `business_id` terkait. |
| **Kasir** | `cashier` | `/pos`, `/pos/riwayat` | Menggunakan RPC `get_store_pos_config`, `create_pos_order`, `get_shift_orders`; tidak dapat membaca HPP/harga modal bahan baku maupun laporan keuangan. |
| **Staf Dapur** | `kitchen` | `/stok` | Menggunakan RPC `get_kitchen_ingredients` & `record_kitchen_waste`; kolom sensitif `cost_per_unit` bahan baku disembunyikan. |

---

## Arsitektur & Keamanan

- **Multi-Tenant Isolation**: Setiap entitas bisnis diikat oleh `business_id` (pada profil pendiri `id = business_id`, dan pada anggota tim `business_id` diset lewat `raw_app_meta_data` oleh Admin SDK di server, tidak dapat dimanipulasi dari input klien).
- **Row Level Security (RLS) & `SECURITY DEFINER` RPC**: Operasi transaksi sensitif seperti checkout POS, simpan pengeluaran struk, penyesuaian stok, dan pengelolaan shift berjalan secara atomik di PostgreSQL.
- **Zona Waktu Deterministik (`Asia/Jakarta` / WIB)**: Perhitungan kunci tanggal harian, grafik tren, dan selisih kedaluwarsa menggunakan helper deterministik di `src/lib/analytics.ts` dan `src/lib/format.ts` agar konsisten antara SSR Node.js dan browser klien (mencegah hydration mismatch).
- **Resilience Tabel Migrasi Modal**: Halaman `/dashboard` dan `/laporan` mendeteksi error tabel belum ada (`isMissingTableError` untuk `capital_entries`) sehingga tetap berjalan normal tanpa crash apabila migrasi `002_business_capital.sql` belum dijalankan, dan halaman `/modal-usaha` menyediakan tombol salin SQL migrasi satu klik.

---

## Tech Stack

| Kategori | Teknologi / Paket (`package.json`) |
| --- | --- |
| **Framework & Runtime** | Next.js `15.5.29` (App Router, Turbopack), React `19.1.0`, TypeScript `^5` |
| **Styling & Ikon** | Tailwind CSS `^4` (`@tailwindcss/postcss`), `@phosphor-icons/react`, `lucide-react`, `clsx`, `tailwind-merge` |
| **Database, Auth & Storage** | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) |
| **AI OCR Struk** | Google GenAI SDK (`@google/genai`) dengan Gemini Flash models |
| **Grafik & Analitik** | Recharts `^3.11.1` |
| **Ekspor Dokumen** | `exceljs` (`.xlsx`), `jspdf` + `jspdf-autotable` (`.pdf`) |
| **PWA & Service Worker** | `@serwist/next` & `serwist` (`^9.6.0`) |
| **Validasi & Optimasi** | `zod` (`^4.6.7`), `sharp` (`^0.35.5`) |

---

## Struktur Direktori

```text
Alca-Money/
├── public/
│   ├── manifest.json                 # Konfigurasi manifest PWA KulinerKas
│   ├── favicon.svg
│   └── icons/                        # Ikon aplikasi 192x192 & 512x512 (any & maskable)
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql    # Skema lengkap tabel, trigger, RLS, RPC & storage buckets
│       └── 002_business_capital.sql  # Migrasi tambahan tabel capital_entries (modal usaha)
├── src/
│   ├── middleware.ts                 # Penjaga sesi auth & RBAC level rute Next.js
│   ├── types/database.ts             # Definisi tipe TypeScript seluruh entitas database
│   ├── app/
│   │   ├── globals.css & layout.tsx  # Theme, font, metadata PWA & viewport
│   │   ├── sw.ts & offline/          # Service worker Serwist & halaman fallback offline
│   │   ├── login/, register/, lupa-password/, reset-password/, auth/callback/
│   │   ├── dashboard/                # Halaman ringkasan keuangan owner
│   │   ├── pos/ & pos/riwayat/       # Terminal kasir POS & riwayat shift/transaksi
│   │   ├── pengeluaran/ & pengeluaran/scan/
│   │   ├── stok/, menu/, modal-usaha/, laporan/, pengaturan-bisnis/
│   │   └── api/
│   │       ├── ocr-receipt/          # OCR struk belanja via Gemini Flash Vision
│   │       ├── receipt-url/          # Generate Signed URL foto struk di bucket privat
│   │       ├── orders/[id]/          # Hapus order & rollback stok/kas (owner)
│   │       ├── expenses/[id]/        # Hapus pengeluaran, rollback stok & hapus file struk
│   │       ├── export/excel/         # Generator file laporan .xlsx (4 sheet)
│   │       ├── staff/ & staff/[id]/  # CRUD akun tim & manajemen peran
│   │       └── account/              # Penghapusan permanen seluruh akun & data bisnis
│   ├── components/
│   │   ├── layout/AppShell.tsx       # Navigasi sidebar desktop & bottom bar mobile per role
│   │   ├── ui/                       # Modal, EmptyState/ErrorState, SchemaMissingNotice
│   │   ├── pwa/InstallPwaBanner.tsx
│   │   ├── pos/                      # PosTerminalClient, PosHistoryClient, ReceiptModal
│   │   ├── dashboard/, menu/, stock/, expenses/, capital/, reports/, settings/
│   └── lib/
│       ├── supabase/                 # Client browser, server cookie SSR, & admin service-role
│       ├── auth.ts                   # Helper requireSession & default route per role
│       ├── analytics.ts              # Kalkulasi P&L, tren harian, komposisi belanja, & modal
│       ├── format.ts                 # Formatter Rupiah, tanggal WIB, & normalisasi WhatsApp
│       ├── image-compress.ts         # Kompresi foto struk sebelum upload OCR
│       ├── printer/escpos.ts         # Web Bluetooth ESC/POS thermal printer & template WA
│       └── export/pdf-report.ts      # Generator PDF laporan keuangan
├── .env.example
└── next.config.ts                    # Konfigurasi Serwist PWA & remotePatterns gambar
```

---

## Skema Database, RPC & Storage

### Tabel PostgreSQL (`public`)
1. `profiles` : Profil user dan konfigurasi bisnis (`business_id`, `role`, `qris_image_url`, `logo_url`, `bank_*`, `tax_rate`, `service_charge_rate`).
2. `ingredients` : Master bahan baku, satuan stok, stok minimum, HPP rata-rata per unit, dan tanggal kedaluwarsa terdekat.
3. `products` : Daftar menu jual, kategori, harga jual, dan foto menu.
4. `recipes` : Relasi komposisi bahan baku per 1 porsi menu.
5. `cashier_shifts` : Shift kasir dan ringkasan kas shift.
6. `orders` & `order_items` : Header transaksi POS dan detail item beserta snapshot `unit_hpp` saat transaksi terjadi.
7. `expenses` & `expense_items` : Catatan belanja/pengeluaran, kategori, sumber dana, path foto struk, serta faktor konversi ke bahan baku.
8. `stock_movements` : Jejak audit setiap perubahan stok (`purchase`, `sale_deduct`, `waste`, `adjustment`).
9. `capital_entries` : Catatan setoran modal (`deposit`) dan penarikan/prive (`withdrawal`) pemilik usaha.

### PostgreSQL Functions (RPC)
- `handle_new_user()` (trigger saat user baru dibuat di `auth.users`)
- `get_my_business_id()` & `get_my_role()` (helper RLS)
- `get_store_pos_config()`, `get_kitchen_ingredients()`, `get_shift_orders()`
- `create_pos_order()`, `open_cashier_shift()`, `get_shift_summary()`, `close_cashier_shift()`
- `save_verified_expense()`, `record_kitchen_waste()`, `adjust_ingredient_stock()`

### Supabase Storage Buckets
- `receipts` (privat, dibaca dengan signed URL khusus owner bisnis terkait)
- `menu-images` (publik read untuk katalog POS, tulis khusus owner)
- `store-assets` (publik read untuk logo & QRIS toko, tulis khusus owner)

---

## API Endpoints

| Method & Path | Akses | Fungsi |
| --- | --- | --- |
| `POST /api/ocr-receipt` | Owner | Mengekstrak teks/item struk belanja via Gemini Vision dan mencocokkan ke daftar `ingredients`. |
| `GET /api/receipt-url?path=...` | Owner | Menghasilkan signed URL sementara untuk melihat foto struk dari bucket privat `receipts`. |
| `DELETE /api/orders/[id]` | Owner | Menghapus order POS, mengembalikan stok bahan baku, dan menyesuaikan shift kasir. |
| `DELETE /api/expenses/[id]` | Owner | Menghapus pengeluaran, membatalkan tambahan stok terkait, dan menghapus gambar struk. |
| `GET /api/export/excel?start=...&end=...` | Owner | Mengunduh laporan keuangan `.xlsx` (4 sheet). |
| `POST /api/staff` | Owner | Membuat akun anggota tim baru (`owner` / `cashier` / `kitchen`). |
| `PATCH /api/staff/[id]` | Owner | Mengubah nama, no. HP, password, role, atau status aktif anggota tim. |
| `DELETE /api/staff/[id]` | Owner | Menghapus akun anggota tim. |
| `DELETE /api/account` | Auth User | Menghapus permanen akun pengguna (dan seluruh aset/data bisnis jika pendiri utama). |

---

## Instalasi & Setup Lokal

### 1. Prasyarat
- **Node.js** versi 20 atau lebih baru & `npm`
- Akun & proyek **Supabase**
- **Google Gemini API Key** (dari Google AI Studio untuk fitur Scan Struk AI)

### 2. Clone Repositori & Pasang Dependensi

```bash
git clone https://github.com/ALCA-DEVELOPER/POS-System.git
cd POS-System
npm install
```

### 3. Konfigurasi Environment Variable

Salin `.env.example` menjadi `.env.local`:

```bash
cp .env.example .env.local
```

Isi seluruh variabel berikut di `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx
SUPABASE_JWKS_URL=https://PROJECT_ID.supabase.co/auth/v1/.well-known/jwks.json
GEMINI_API_KEY=your_gemini_api_key
```

> **Penting untuk Proyek Supabase Baru (`next.config.ts`)**:
> Jika Anda menggunakan proyek Supabase sendiri (hostname berbeda), perbarui `images.remotePatterns[].hostname` di [next.config.ts](next.config.ts) agar cocok dengan domain Supabase Storage Anda (`<PROJECT_ID>.supabase.co`) supaya komponen gambar Next.js (`Logo`, `QRIS`, dan `Foto Menu`) dapat dimuat.

### 4. Jalankan Migrasi SQL di Supabase

1. Buka **Supabase Dashboard -> SQL Editor**.
2. Untuk setup baru, salin seluruh isi `supabase/migrations/001_initial_schema.sql`, tempel, lalu klik **Run**.
3. Jika database sudah terpasang sebelum fitur Modal Usaha, jalankan tambahan `supabase/migrations/002_business_capital.sql`.
4. Di pengaturan **Supabase Authentication -> URL Configuration**, pastikan URL aplikasi (misal `http://localhost:3000/auth/callback` dan domain production Anda) ditambahkan ke daftar *Redirect URLs*.

### 5. Jalankan Development Server

```bash
npm run dev
```

Buka `http://localhost:3000`, daftar akun bisnis pertama melalui `/register`, dan aplikasi siap digunakan.

---

## Skrip NPM

| Perintah | Keterangan |
| --- | --- |
| `npm run dev` | Menjalankan server pengembangan Next.js (`--turbopack`). Service worker PWA dinonaktifkan saat mode development. |
| `npm run build` | Membangun aplikasi production sekaligus mengkompilasi Service Worker PWA (`public/sw.js`). |
| `npm run start` | Menjalankan hasil build production. |
| `npm run typecheck` | Mengecek seluruh tipe TypeScript (`tsc --noEmit`). |
| `npm run lint` | Menjalankan ESLint untuk memeriksa kualitas kode. |

---

## Catatan Deployment

- Saat deploy ke **Vercel** atau platform hosting Node.js lainnya, tambahkan seluruh key dari `.env.example` ke *Environment Variables* di dashboard hosting. Jangan pernah mengunggah `.env.local` ke repositori publik.
- Pastikan fitur **Web Bluetooth** (untuk cetak printer thermal langsung dari browser) diakses melalui **HTTPS** atau `localhost`, serta gunakan browser berbasis Chromium (Chrome/Edge di Android/Desktop). Untuk Safari/iOS, cetak struk tetap dapat dilakukan melalui tombol **Cetak / Print** atau bagikan lewat **WhatsApp**.
- Build PWA (`public/sw.js` dan `public/swe-worker-*.js`) di-generate saat `npm run build` dan tidak perlu di-commit ke Git (sudah tercantum di `.gitignore`).

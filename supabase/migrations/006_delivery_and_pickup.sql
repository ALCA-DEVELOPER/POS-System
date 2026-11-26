-- ============================================================================
-- KulinerKas - Pilihan COD / Ambil di Lokasi & Antar ke Kos (+Ongkir)
-- Target: Supabase PostgreSQL 15+ (Aman dijalankan berulang)
-- ============================================================================

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_payment_method_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_payment_method_check
  CHECK (payment_method IN ('qris', 'transfer'));

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'pickup'
    CHECK (delivery_type IN ('pickup', 'delivery')),
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS delivery_address TEXT NOT NULL DEFAULT '';

ALTER TABLE public.storefront_settings
  ADD COLUMN IF NOT EXISTS enable_transfer BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transfer_instruction TEXT NOT NULL DEFAULT 'Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.',
  ADD COLUMN IF NOT EXISTS enable_pickup BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_delivery BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 1500
    CHECK (delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS pickup_info TEXT NOT NULL DEFAULT 'Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB.',
  ADD COLUMN IF NOT EXISTS delivery_info TEXT NOT NULL DEFAULT 'Diantar langsung ke area kos Purwokerto (ongkir Rp 1.500).';

ALTER TABLE public.storefront_settings
  ALTER COLUMN delivery_fee SET DEFAULT 1500,
  ALTER COLUMN delivery_info SET DEFAULT 'Diantar langsung ke area kos Purwokerto (ongkir Rp 1.500).';

UPDATE public.storefront_settings
SET
  delivery_fee = CASE WHEN delivery_fee = 2000 THEN 1500 ELSE delivery_fee END,
  delivery_info = CASE
    WHEN delivery_info = 'Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000).'
      THEN 'Diantar langsung ke area kos Purwokerto (ongkir Rp 1.500).'
    ELSE delivery_info
  END;

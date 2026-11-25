-- ============================================================================
-- KulinerKas - Dukungan Transfer Bank pada Pesanan Pembeli (/pesan)
-- Target: Supabase PostgreSQL 15+
-- ============================================================================

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_payment_method_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_payment_method_check
  CHECK (payment_method IN ('qris', 'transfer'));

ALTER TABLE public.storefront_settings
  ADD COLUMN IF NOT EXISTS enable_transfer BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transfer_instruction TEXT NOT NULL DEFAULT 'Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.';

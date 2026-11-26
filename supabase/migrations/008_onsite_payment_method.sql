-- ============================================================================
-- KulinerKas - Dukungan Pencatatan Onsite ('cash') pada customer_orders
-- Target: Supabase PostgreSQL 15+ (Aman dijalankan berulang)
-- ============================================================================

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_payment_method_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_payment_method_check
  CHECK (payment_method IN ('qris', 'transfer', 'cash'));

ALTER TABLE public.storefront_settings
  ALTER COLUMN cash_instruction
  SET DEFAULT 'Pesanan Onsite otomatis tercatat di sistem antrean toko dan dilanjutkan ke chat WhatsApp. Pembayaran tunai dilakukan saat COD atau pesanan diantar.';

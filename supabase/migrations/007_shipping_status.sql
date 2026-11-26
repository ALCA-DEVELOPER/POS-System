-- ============================================================================
-- KulinerKas - Dukungan Status Sedang Diantar ('shipping') pada customer_orders
-- Target: Supabase PostgreSQL 15+ (Aman dijalankan berulang)
-- ============================================================================

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_fulfillment_status_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('pending', 'preparing', 'ready', 'shipping', 'completed', 'cancelled'));

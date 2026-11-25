-- ============================================================================
-- KulinerKas - Tabel Pesanan Pembeli (Storefront QRIS Tanpa Login)
-- Target: Supabase PostgreSQL 15+
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'qris' CHECK (payment_method IN ('qris')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'rejected')),
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  linked_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  paid_verified_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_biz_created
  ON public.customer_orders(business_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_customer_orders_updated_at ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_updated_at
  BEFORE UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_orders_team_all ON public.customer_orders;
CREATE POLICY customer_orders_team_all ON public.customer_orders
  FOR ALL USING (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'customer_orders'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
  END IF;
END;
$$;

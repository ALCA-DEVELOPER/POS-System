-- ============================================================================
-- KulinerKas - Initial Database Schema, Multi-Tenant RLS & Atomic RPCs
-- Target: Supabase PostgreSQL 15+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'cashier', 'kitchen')) DEFAULT 'owner',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  qris_image_url TEXT,
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  bank_account_holder TEXT NOT NULL DEFAULT '',
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  service_charge_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (service_charge_rate >= 0 AND service_charge_rate <= 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_business_id ON public.profiles(business_id);

CREATE TABLE IF NOT EXISTS public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('gram', 'ml', 'pcs', 'kg', 'liter')),
  current_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  minimum_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  cost_per_unit NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
  nearest_expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_user_id ON public.ingredients(user_id);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL CHECK (category IN ('Makanan', 'Minuman', 'Paket', 'Topping')),
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products(user_id);

CREATE TABLE IF NOT EXISTS public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity_needed NUMERIC(14,3) NOT NULL CHECK (quantity_needed > 0),
  UNIQUE (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_recipes_product_id ON public.recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_ingredient_id ON public.recipes(ingredient_id);

CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cash NUMERIC(14,2),
  cash_difference NUMERIC(14,2),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_user_id ON public.cashier_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_cashier_status ON public.cashier_shifts(cashier_id, status);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  shift_id UUID REFERENCES public.cashier_shifts(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  service_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  hpp_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  change_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'qris', 'transfer')),
  order_type TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'online')),
  customer_phone TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shift ON public.orders(shift_id);

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL,
  unit_hpp NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('Bahan Baku', 'Kemasan', 'Sewa', 'Gaji', 'Listrik', 'Operasional')),
  description TEXT NOT NULL DEFAULT '',
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('cash', 'bank', 'qris')) DEFAULT 'cash',
  receipt_image_url TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON public.expenses(user_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES public.ingredients(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  stock_conversion_factor NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (stock_conversion_factor > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_expense_items_expense_id ON public.expense_items(expense_id);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale_deduct', 'waste', 'adjustment')),
  quantity_delta NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,4),
  reference_id UUID,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_user_created ON public.stock_movements(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient ON public.stock_movements(ingredient_id);

CREATE TABLE IF NOT EXISTS public.capital_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit', 'withdrawal')) DEFAULT 'deposit',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('cash', 'bank', 'qris')) DEFAULT 'cash',
  notes TEXT NOT NULL DEFAULT '',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capital_entries_user_date ON public.capital_entries(user_id, entry_date DESC);

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
  payment_method TEXT NOT NULL DEFAULT 'qris' CHECK (payment_method IN ('qris', 'transfer')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'rejected')),
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery')),
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  linked_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  paid_verified_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_biz_created ON public.customer_orders(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  business_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_open BOOLEAN NOT NULL DEFAULT true,
  closed_message TEXT NOT NULL DEFAULT 'Maaf, pemesanan online sedang tutup sementara. Silakan hubungi WhatsApp kami.',
  poster_url TEXT,
  poster_caption TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  featured_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  custom_title TEXT NOT NULL DEFAULT '',
  custom_description TEXT NOT NULL DEFAULT '',
  custom_price NUMERIC(14,2) CHECK (custom_price IS NULL OR custom_price >= 0),
  enable_qris BOOLEAN NOT NULL DEFAULT true,
  enable_transfer BOOLEAN NOT NULL DEFAULT true,
  enable_cash_chat BOOLEAN NOT NULL DEFAULT true,
  qris_instruction TEXT NOT NULL DEFAULT 'Setelah berhasil transfer via QRIS, tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.',
  transfer_instruction TEXT NOT NULL DEFAULT 'Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.',
  cash_instruction TEXT NOT NULL DEFAULT 'Untuk menjaga ketersediaan stok, pemesanan onsite (bayar di tempat) langsung dikonfirmasi lewat chat WhatsApp dengan detail pesanan Anda.',
  enable_pickup BOOLEAN NOT NULL DEFAULT true,
  enable_delivery BOOLEAN NOT NULL DEFAULT true,
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 2000 CHECK (delivery_fee >= 0),
  pickup_info TEXT NOT NULL DEFAULT 'Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB.',
  delivery_info TEXT NOT NULL DEFAULT 'Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000).',
  whatsapp_number TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. UPDATED_AT TRIGGER & AUTH PROFILE BOOTSTRAP
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ingredients_updated_at ON public.ingredients;
CREATE TRIGGER trg_ingredients_updated_at
  BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_capital_entries_updated_at ON public.capital_entries;
CREATE TRIGGER trg_capital_entries_updated_at
  BEFORE UPDATE ON public.capital_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_orders_updated_at ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_updated_at
  BEFORE UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_storefront_settings_updated_at ON public.storefront_settings;
CREATE TRIGGER trg_storefront_settings_updated_at
  BEFORE UPDATE ON public.storefront_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_business_id UUID;
  v_app_role TEXT;
  v_business_name TEXT;
  v_owner_name TEXT;
  v_full_name TEXT;
  v_phone TEXT;
BEGIN
  -- Security: only trust business_id & role from app_metadata (admin-only),
  -- never from client-editable raw_user_meta_data.
  v_app_business_id := NULLIF(NEW.raw_app_meta_data->>'business_id', '')::UUID;
  v_app_role := NULLIF(NEW.raw_app_meta_data->>'role', '');

  IF v_app_business_id IS NULL THEN
    v_app_business_id := NEW.id;
    v_app_role := 'owner';
  END IF;

  IF v_app_role NOT IN ('owner', 'cashier', 'kitchen') THEN
    v_app_role := 'owner';
  END IF;

  v_business_name := COALESCE(NEW.raw_user_meta_data->>'business_name', '');
  v_owner_name := COALESCE(NEW.raw_user_meta_data->>'owner_name', '');
  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), v_owner_name, '');
  v_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');

  INSERT INTO public.profiles (
    id, business_id, business_name, owner_name, full_name, role, phone
  ) VALUES (
    NEW.id, v_app_business_id, v_business_name, v_owner_name, v_full_name, v_app_role, v_phone
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. RLS HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_business_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 4. ENABLE ROW LEVEL SECURITY & POLICIES
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capital_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;

-- PROFILES
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR (public.get_my_role() = 'owner' AND business_id = public.get_my_business_id())
  );

DROP POLICY IF EXISTS profiles_update_self_or_owner ON public.profiles;
CREATE POLICY profiles_update_self_or_owner ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR (public.get_my_role() = 'owner' AND business_id = public.get_my_business_id())
  )
  WITH CHECK (
    (
      id = auth.uid()
      AND role = public.get_my_role()
      AND business_id = public.get_my_business_id()
    )
    OR (
      public.get_my_role() = 'owner'
      AND business_id = public.get_my_business_id()
    )
  );

-- INGREDIENTS (Owner only for direct table read/write; kitchen uses safe RPC)
DROP POLICY IF EXISTS ingredients_owner_all ON public.ingredients;
CREATE POLICY ingredients_owner_all ON public.ingredients
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );

-- PRODUCTS (All active business members can read active menu; owner has full CRUD)
DROP POLICY IF EXISTS products_select_business ON public.products;
CREATE POLICY products_select_business ON public.products
  FOR SELECT USING (
    user_id = public.get_my_business_id()
  );

DROP POLICY IF EXISTS products_owner_write ON public.products;
CREATE POLICY products_owner_write ON public.products
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );

-- RECIPES (Owner only, protects HPP formula from cashier)
DROP POLICY IF EXISTS recipes_owner_all ON public.recipes;
CREATE POLICY recipes_owner_all ON public.recipes
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = recipes.product_id AND p.user_id = public.get_my_business_id()
    )
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = recipes.product_id AND p.user_id = public.get_my_business_id()
    )
  );

-- CASHIER SHIFTS
DROP POLICY IF EXISTS shifts_select ON public.cashier_shifts;
CREATE POLICY shifts_select ON public.cashier_shifts
  FOR SELECT USING (
    user_id = public.get_my_business_id()
    AND (public.get_my_role() = 'owner' OR cashier_id = auth.uid())
  );

DROP POLICY IF EXISTS shifts_insert ON public.cashier_shifts;
CREATE POLICY shifts_insert ON public.cashier_shifts
  FOR INSERT WITH CHECK (
    user_id = public.get_my_business_id()
    AND cashier_id = auth.uid()
    AND public.get_my_role() IN ('owner', 'cashier')
  );

DROP POLICY IF EXISTS shifts_update ON public.cashier_shifts;
CREATE POLICY shifts_update ON public.cashier_shifts
  FOR UPDATE USING (
    user_id = public.get_my_business_id()
    AND (public.get_my_role() = 'owner' OR cashier_id = auth.uid())
  )
  WITH CHECK (
    user_id = public.get_my_business_id()
  );

-- ORDERS & ORDER ITEMS (Direct table read restricted to Owner so hpp_total/unit_hpp are never exposed to cashier; cashier uses safe RPC)
DROP POLICY IF EXISTS orders_owner_all ON public.orders;
CREATE POLICY orders_owner_all ON public.orders
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );

DROP POLICY IF EXISTS order_items_owner_all ON public.order_items;
CREATE POLICY order_items_owner_all ON public.order_items
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id AND o.user_id = public.get_my_business_id()
    )
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id AND o.user_id = public.get_my_business_id()
    )
  );

-- EXPENSES & EXPENSE ITEMS (Owner only)
DROP POLICY IF EXISTS expenses_owner_all ON public.expenses;
CREATE POLICY expenses_owner_all ON public.expenses
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );

DROP POLICY IF EXISTS expense_items_owner_all ON public.expense_items;
CREATE POLICY expense_items_owner_all ON public.expense_items
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_items.expense_id AND e.user_id = public.get_my_business_id()
    )
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_items.expense_id AND e.user_id = public.get_my_business_id()
    )
  );

-- STOCK MOVEMENTS (Owner full access; kitchen can view non-cost movements)
DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
CREATE POLICY stock_movements_select ON public.stock_movements
  FOR SELECT USING (
    user_id = public.get_my_business_id()
    AND public.get_my_role() IN ('owner', 'kitchen')
  );

DROP POLICY IF EXISTS stock_movements_owner_write ON public.stock_movements;
CREATE POLICY stock_movements_owner_write ON public.stock_movements
  FOR INSERT WITH CHECK (
    user_id = public.get_my_business_id()
    AND public.get_my_role() = 'owner'
  );

-- CAPITAL ENTRIES (Owner only)
DROP POLICY IF EXISTS capital_entries_owner_all ON public.capital_entries;
CREATE POLICY capital_entries_owner_all ON public.capital_entries
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );

-- CUSTOMER ORDERS (Web QRIS Storefront Orders, Owner & Cashier access)
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

-- STOREFRONT SETTINGS (Team read, Owner write)
DROP POLICY IF EXISTS storefront_settings_team_select ON public.storefront_settings;
CREATE POLICY storefront_settings_team_select ON public.storefront_settings
  FOR SELECT USING (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  );

DROP POLICY IF EXISTS storefront_settings_owner_write ON public.storefront_settings;
CREATE POLICY storefront_settings_owner_write ON public.storefront_settings
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND business_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND business_id = public.get_my_business_id()
  );

-- ----------------------------------------------------------------------------
-- 5. SAFE ROLE-SCOPED RPCs & ATOMIC BUSINESS TRANSACTIONS
-- ----------------------------------------------------------------------------

-- Safe store settings for POS (Cashier & Owner) without leaking staff/private data
CREATE OR REPLACE FUNCTION public.get_store_pos_config()
RETURNS TABLE (
  business_id UUID,
  business_name TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  qris_image_url TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_holder TEXT,
  tax_rate NUMERIC,
  service_charge_rate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.business_id,
    p.business_name,
    p.phone,
    p.address,
    p.logo_url,
    p.qris_image_url,
    p.bank_name,
    p.bank_account_number,
    p.bank_account_holder,
    p.tax_rate,
    p.service_charge_rate
  FROM public.profiles p
  WHERE p.id = public.get_my_business_id()
  LIMIT 1;
$$;

-- Safe ingredient list for Kitchen/Owner (omits cost_per_unit when role = 'kitchen')
CREATE OR REPLACE FUNCTION public.get_kitchen_ingredients()
RETURNS TABLE (
  id UUID,
  name TEXT,
  unit TEXT,
  current_stock NUMERIC,
  minimum_stock NUMERIC,
  nearest_expiry_date DATE,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.name,
    i.unit,
    i.current_stock,
    i.minimum_stock,
    i.nearest_expiry_date,
    i.updated_at
  FROM public.ingredients i
  WHERE i.user_id = public.get_my_business_id()
    AND public.get_my_role() IN ('owner', 'kitchen')
  ORDER BY i.name ASC;
$$;

-- Safe shift orders list for Cashier (omits hpp_total and unit_hpp)
CREATE OR REPLACE FUNCTION public.get_shift_orders(p_shift_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  subtotal NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  service_amount NUMERIC,
  total_amount NUMERIC,
  amount_paid NUMERIC,
  change_amount NUMERIC,
  payment_method TEXT,
  order_type TEXT,
  customer_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ,
  items JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.order_number,
    o.subtotal,
    o.discount_amount,
    o.tax_amount,
    o.service_amount,
    o.total_amount,
    o.amount_paid,
    o.change_amount,
    o.payment_method,
    o.order_type,
    o.customer_phone,
    o.notes,
    o.created_at,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', oi.product_name,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'subtotal', oi.subtotal
          )
        )
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      ),
      '[]'::jsonb
    ) AS items
  FROM public.orders o
  WHERE o.user_id = public.get_my_business_id()
    AND public.get_my_role() IN ('owner', 'cashier')
    AND (
      public.get_my_role() = 'owner'
      OR o.cashier_id = auth.uid()
    )
    AND (p_shift_id IS NULL OR o.shift_id = p_shift_id)
  ORDER BY o.created_at DESC
  LIMIT 100;
$$;

-- Atomic POS Checkout: validates prices server-side, computes HPP, deducts stock, updates shift cash
CREATE OR REPLACE FUNCTION public.create_pos_order(
  p_shift_id UUID,
  p_order_type TEXT,
  p_payment_method TEXT,
  p_discount_amount NUMERIC DEFAULT 0,
  p_amount_paid NUMERIC DEFAULT 0,
  p_customer_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT '',
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_tax_rate NUMERIC(5,2);
  v_service_rate NUMERIC(5,2);
  v_shift RECORD;
  v_order_id UUID := gen_random_uuid();
  v_order_number TEXT;
  v_seq INTEGER;
  v_today_key TEXT;
  v_subtotal NUMERIC(14,2) := 0;
  v_discount NUMERIC(14,2) := GREATEST(COALESCE(p_discount_amount, 0), 0);
  v_taxable NUMERIC(14,2) := 0;
  v_service NUMERIC(14,2) := 0;
  v_tax NUMERIC(14,2) := 0;
  v_total NUMERIC(14,2) := 0;
  v_hpp_total NUMERIC(14,2) := 0;
  v_paid NUMERIC(14,2) := COALESCE(p_amount_paid, 0);
  v_change NUMERIC(14,2) := 0;
  v_item JSONB;
  v_product RECORD;
  v_qty INTEGER;
  v_line_subtotal NUMERIC(14,2);
  v_unit_hpp NUMERIC(14,2);
  v_recipe RECORD;
  v_deduct_qty NUMERIC(14,3);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autentikasi diperlukan';
  END IF;

  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Akses kasir ditolak';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang pesanan masih kosong';
  END IF;

  IF p_order_type NOT IN ('dine_in', 'takeaway', 'online') THEN
    RAISE EXCEPTION 'Tipe pesanan tidak valid';
  END IF;

  IF p_payment_method NOT IN ('cash', 'qris', 'transfer') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid';
  END IF;

  SELECT * INTO v_shift
  FROM public.cashier_shifts
  WHERE id = p_shift_id AND user_id = v_business_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift kasir belum dibuka atau sudah ditutup';
  END IF;

  SELECT tax_rate, service_charge_rate INTO v_tax_rate, v_service_rate
  FROM public.profiles
  WHERE id = v_business_id;

  -- Lock per business & day for clean sequential order numbers
  v_today_key := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext(v_business_id::text || '-' || v_today_key));

  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.orders
  WHERE user_id = v_business_id
    AND order_number LIKE 'KK-' || v_today_key || '-%';

  v_order_number := 'KK-' || v_today_key || '-' || lpad(v_seq::text, 3, '0');

  -- First pass: compute subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Kuantitas item harus lebih dari 0';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::UUID
      AND user_id = v_business_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu tidak ditemukan atau tidak aktif';
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  END LOOP;

  IF v_discount > v_subtotal THEN
    v_discount := v_subtotal;
  END IF;

  v_taxable := v_subtotal - v_discount;
  v_service := ROUND(v_taxable * (COALESCE(v_service_rate, 0) / 100.0), 0);
  v_tax := ROUND(v_taxable * (COALESCE(v_tax_rate, 0) / 100.0), 0);
  v_total := v_taxable + v_service + v_tax;

  IF p_payment_method = 'cash' THEN
    IF v_paid < v_total THEN
      RAISE EXCEPTION 'Nominal tunai kurang dari total tagihan';
    END IF;
    v_change := v_paid - v_total;
  ELSE
    v_paid := v_total;
    v_change := 0;
  END IF;

  -- Insert order header first with placeholder hpp_total, update after items
  INSERT INTO public.orders (
    id, user_id, cashier_id, shift_id, order_number,
    subtotal, discount_amount, tax_amount, service_amount,
    total_amount, hpp_total, amount_paid, change_amount,
    payment_method, order_type, customer_phone, notes
  ) VALUES (
    v_order_id, v_business_id, v_actor_id, v_shift.id, v_order_number,
    v_subtotal, v_discount, v_tax, v_service,
    v_total, 0, v_paid, v_change,
    p_payment_method, p_order_type, NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''), COALESCE(p_notes, '')
  );

  -- Second pass: insert items, snapshot unit HPP, and deduct stock per recipe
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::INTEGER;
    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::UUID AND user_id = v_business_id;

    v_line_subtotal := v_product.price * v_qty;

    SELECT COALESCE(SUM(r.quantity_needed * i.cost_per_unit), 0) INTO v_unit_hpp
    FROM public.recipes r
    JOIN public.ingredients i ON i.id = r.ingredient_id
    WHERE r.product_id = v_product.id;

    v_hpp_total := v_hpp_total + (v_unit_hpp * v_qty);

    INSERT INTO public.order_items (
      order_id, product_id, product_name, quantity, unit_price, unit_hpp, subtotal
    ) VALUES (
      v_order_id, v_product.id, v_product.name, v_qty, v_product.price, v_unit_hpp, v_line_subtotal
    );

    FOR v_recipe IN
      SELECT r.ingredient_id, r.quantity_needed
      FROM public.recipes r
      WHERE r.product_id = v_product.id
    LOOP
      v_deduct_qty := v_recipe.quantity_needed * v_qty;

      UPDATE public.ingredients
      SET current_stock = current_stock - v_deduct_qty
      WHERE id = v_recipe.ingredient_id AND user_id = v_business_id;

      INSERT INTO public.stock_movements (
        user_id, ingredient_id, actor_id, movement_type, quantity_delta, reference_id, notes
      ) VALUES (
        v_business_id, v_recipe.ingredient_id, v_actor_id, 'sale_deduct', -v_deduct_qty, v_order_id,
        'Penjualan ' || v_order_number || ' (' || v_product.name || ' x' || v_qty || ')'
      );
    END LOOP;
  END LOOP;

  UPDATE public.orders SET hpp_total = ROUND(v_hpp_total, 2) WHERE id = v_order_id;

  IF p_payment_method = 'cash' THEN
    UPDATE public.cashier_shifts
    SET expected_cash = expected_cash + v_total
    WHERE id = v_shift.id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', v_tax,
    'service_amount', v_service,
    'total_amount', v_total,
    'amount_paid', v_paid,
    'change_amount', v_change,
    'payment_method', p_payment_method,
    'order_type', p_order_type,
    'created_at', NOW()
  );
END;
$$;

-- Atomic Verified Expense & Stock Sync (Owner only)
CREATE OR REPLACE FUNCTION public.save_verified_expense(
  p_supplier_name TEXT,
  p_category TEXT,
  p_description TEXT,
  p_expense_date DATE,
  p_tax_amount NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_total_amount NUMERIC DEFAULT 0,
  p_payment_source TEXT DEFAULT 'cash',
  p_receipt_image_url TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_expense_id UUID := gen_random_uuid();
  v_item JSONB;
  v_ing_id UUID;
  v_new_ing_name TEXT;
  v_new_ing_unit TEXT;
  v_qty NUMERIC(14,3);
  v_factor NUMERIC(14,4);
  v_unit_price NUMERIC(14,2);
  v_line_subtotal NUMERIC(14,2);
  v_stock_added NUMERIC(14,3);
  v_ing RECORD;
  v_new_cost NUMERIC(14,4);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autentikasi diperlukan';
  END IF;

  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'Hanya owner yang dapat menyimpan pengeluaran';
  END IF;

  INSERT INTO public.expenses (
    id, user_id, supplier_name, category, description,
    tax_amount, discount_amount, amount, payment_source,
    receipt_image_url, expense_date
  ) VALUES (
    v_expense_id, v_business_id, COALESCE(p_supplier_name, ''),
    p_category, COALESCE(p_description, ''),
    COALESCE(p_tax_amount, 0), COALESCE(p_discount_amount, 0),
    COALESCE(p_total_amount, 0), COALESCE(p_payment_source, 'cash'),
    p_receipt_image_url, COALESCE(p_expense_date, CURRENT_DATE)
  );

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_qty := GREATEST(COALESCE((v_item->>'quantity')::NUMERIC, 1), 0.001);
      v_factor := GREATEST(COALESCE((v_item->>'stock_conversion_factor')::NUMERIC, 1), 0.0001);
      v_unit_price := GREATEST(COALESCE((v_item->>'unit_price')::NUMERIC, 0), 0);
      v_line_subtotal := GREATEST(COALESCE((v_item->>'subtotal')::NUMERIC, v_qty * v_unit_price), 0);
      v_ing_id := NULLIF(COALESCE(v_item->>'ingredient_id', ''), '')::UUID;
      v_new_ing_name := NULLIF(TRIM(COALESCE(v_item->>'create_ingredient_name', '')), '');
      v_new_ing_unit := COALESCE(NULLIF(v_item->>'create_ingredient_unit', ''), 'pcs');

      IF v_ing_id IS NULL AND v_new_ing_name IS NOT NULL THEN
        IF v_new_ing_unit NOT IN ('gram', 'ml', 'pcs', 'kg', 'liter') THEN
          v_new_ing_unit := 'pcs';
        END IF;
        INSERT INTO public.ingredients (
          user_id, name, unit, current_stock, minimum_stock, cost_per_unit
        ) VALUES (
          v_business_id, v_new_ing_name, v_new_ing_unit, 0, 0, 0
        ) RETURNING id INTO v_ing_id;
      END IF;

      INSERT INTO public.expense_items (
        expense_id, ingredient_id, item_name, quantity, unit,
        stock_conversion_factor, unit_price, subtotal
      ) VALUES (
        v_expense_id, v_ing_id, COALESCE(v_item->>'item_name', 'Item'),
        v_qty, COALESCE(v_item->>'unit', 'pcs'),
        v_factor, v_unit_price, v_line_subtotal
      );

      IF v_ing_id IS NOT NULL THEN
        SELECT * INTO v_ing
        FROM public.ingredients
        WHERE id = v_ing_id AND user_id = v_business_id
        FOR UPDATE;

        IF FOUND THEN
          v_stock_added := v_qty * v_factor;
          IF v_ing.current_stock > 0 THEN
            v_new_cost := ((v_ing.current_stock * v_ing.cost_per_unit) + v_line_subtotal)
              / (v_ing.current_stock + v_stock_added);
          ELSE
            v_new_cost := v_line_subtotal / v_stock_added;
          END IF;

          UPDATE public.ingredients
          SET
            current_stock = current_stock + v_stock_added,
            cost_per_unit = ROUND(GREATEST(v_new_cost, 0), 4)
          WHERE id = v_ing.id;

          INSERT INTO public.stock_movements (
            user_id, ingredient_id, actor_id, movement_type,
            quantity_delta, unit_cost, reference_id, notes
          ) VALUES (
            v_business_id, v_ing.id, v_actor_id, 'purchase',
            v_stock_added, ROUND(v_line_subtotal / v_stock_added, 4),
            v_expense_id,
            'Pembelian dari ' || COALESCE(NULLIF(p_supplier_name, ''), 'Supplier')
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('expense_id', v_expense_id);
END;
$$;

-- Kitchen / Owner Waste Logging
CREATE OR REPLACE FUNCTION public.record_kitchen_waste(
  p_ingredient_id UUID,
  p_quantity NUMERIC,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_ing RECORD;
  v_qty NUMERIC(14,3) := COALESCE(p_quantity, 0);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autentikasi diperlukan';
  END IF;

  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role NOT IN ('owner', 'kitchen') THEN
    RAISE EXCEPTION 'Akses pencatatan waste ditolak';
  END IF;

  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Jumlah bahan sisa harus lebih dari 0';
  END IF;

  SELECT * INTO v_ing
  FROM public.ingredients
  WHERE id = p_ingredient_id AND user_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bahan baku tidak ditemukan';
  END IF;

  UPDATE public.ingredients
  SET current_stock = current_stock - v_qty
  WHERE id = v_ing.id;

  INSERT INTO public.stock_movements (
    user_id, ingredient_id, actor_id, movement_type,
    quantity_delta, notes
  ) VALUES (
    v_business_id, v_ing.id, v_actor_id, 'waste',
    -v_qty, COALESCE(NULLIF(TRIM(p_reason), ''), 'Bahan sisa / rusak dapur')
  );

  RETURN jsonb_build_object(
    'ingredient_id', v_ing.id,
    'new_stock', v_ing.current_stock - v_qty
  );
END;
$$;

-- Open Cashier Shift (Cashier or Owner)
CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_opening_cash NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT ''
)
RETURNS public.cashier_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_existing public.cashier_shifts;
  v_shift public.cashier_shifts;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autentikasi diperlukan';
  END IF;

  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Akses buka kasir ditolak';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'Modal awal tidak boleh negatif';
  END IF;

  SELECT * INTO v_existing
  FROM public.cashier_shifts
  WHERE cashier_id = v_actor_id AND user_id = v_business_id AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.cashier_shifts (
    user_id, cashier_id, opening_cash, expected_cash, status, notes
  ) VALUES (
    v_business_id, v_actor_id, COALESCE(p_opening_cash, 0), COALESCE(p_opening_cash, 0), 'open', COALESCE(p_notes, '')
  )
  RETURNING * INTO v_shift;

  RETURN v_shift;
END;
$$;

-- Get Shift Payment Breakdown (omits HPP/profit)
CREATE OR REPLACE FUNCTION public.get_shift_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_shift public.cashier_shifts;
  v_cash_sales NUMERIC(14,2) := 0;
  v_qris_sales NUMERIC(14,2) := 0;
  v_transfer_sales NUMERIC(14,2) := 0;
  v_order_count INTEGER := 0;
BEGIN
  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO v_shift
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND user_id = v_business_id
    AND (v_role = 'owner' OR cashier_id = v_actor_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'qris' THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total_amount ELSE 0 END), 0)
  INTO v_order_count, v_cash_sales, v_qris_sales, v_transfer_sales
  FROM public.orders
  WHERE shift_id = v_shift.id AND user_id = v_business_id;

  RETURN jsonb_build_object(
    'shift_id', v_shift.id,
    'status', v_shift.status,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'opening_cash', v_shift.opening_cash,
    'expected_cash', v_shift.expected_cash,
    'actual_cash', v_shift.actual_cash,
    'cash_difference', v_shift.cash_difference,
    'order_count', v_order_count,
    'cash_sales', v_cash_sales,
    'qris_sales', v_qris_sales,
    'transfer_sales', v_transfer_sales,
    'total_sales', v_cash_sales + v_qris_sales + v_transfer_sales
  );
END;
$$;

-- Close Cashier Shift
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_notes TEXT DEFAULT ''
)
RETURNS public.cashier_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_shift public.cashier_shifts;
  v_actual NUMERIC(14,2) := COALESCE(p_actual_cash, 0);
BEGIN
  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Akses tutup kasir ditolak';
  END IF;

  IF v_actual < 0 THEN
    RAISE EXCEPTION 'Uang fisik tidak boleh negatif';
  END IF;

  SELECT * INTO v_shift
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND user_id = v_business_id
    AND status = 'open'
    AND (v_role = 'owner' OR cashier_id = v_actor_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift kasir tidak ditemukan atau sudah ditutup';
  END IF;

  UPDATE public.cashier_shifts
  SET
    actual_cash = v_actual,
    cash_difference = v_actual - expected_cash,
    status = 'closed',
    notes = CASE WHEN COALESCE(TRIM(p_notes), '') <> '' THEN TRIM(p_notes) ELSE notes END,
    closed_at = NOW()
  WHERE id = v_shift.id
  RETURNING * INTO v_shift;

  RETURN v_shift;
END;
$$;

-- Owner Stock Opname / Adjustment
CREATE OR REPLACE FUNCTION public.adjust_ingredient_stock(
  p_ingredient_id UUID,
  p_new_stock NUMERIC,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_business_id UUID;
  v_role TEXT;
  v_ing public.ingredients;
  v_delta NUMERIC(14,3);
BEGIN
  SELECT business_id, role INTO v_business_id, v_role
  FROM public.profiles
  WHERE id = v_actor_id AND is_active = true;

  IF v_business_id IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'Hanya owner yang dapat melakukan penyesuaian stok';
  END IF;

  SELECT * INTO v_ing
  FROM public.ingredients
  WHERE id = p_ingredient_id AND user_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bahan baku tidak ditemukan';
  END IF;

  v_delta := p_new_stock - v_ing.current_stock;

  UPDATE public.ingredients
  SET current_stock = p_new_stock
  WHERE id = v_ing.id;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements (
      user_id, ingredient_id, actor_id, movement_type, quantity_delta, notes
    ) VALUES (
      v_business_id, v_ing.id, v_actor_id, 'adjustment', v_delta,
      COALESCE(NULLIF(TRIM(p_notes), ''), 'Stock opname manual')
    );
  END IF;

  RETURN jsonb_build_object(
    'ingredient_id', v_ing.id,
    'previous_stock', v_ing.current_stock,
    'new_stock', p_new_stock,
    'delta', v_delta
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. STORAGE BUCKETS & STORAGE RLS POLICIES
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('receipts', 'receipts', false),
  ('menu-images', 'menu-images', true),
  ('store-assets', 'store-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Receipts: private per UMKM (path: <business_id>/<filename>)
DROP POLICY IF EXISTS receipts_owner_select ON storage.objects;
CREATE POLICY receipts_owner_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'receipts'
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

DROP POLICY IF EXISTS receipts_owner_insert ON storage.objects;
CREATE POLICY receipts_owner_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'receipts'
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

DROP POLICY IF EXISTS receipts_owner_delete ON storage.objects;
CREATE POLICY receipts_owner_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'receipts'
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

-- Menu Images & Store Assets: public read for POS/QRIS, owner write in own folder
DROP POLICY IF EXISTS public_assets_read ON storage.objects;
CREATE POLICY public_assets_read ON storage.objects
  FOR SELECT USING (bucket_id IN ('menu-images', 'store-assets'));

DROP POLICY IF EXISTS public_assets_owner_insert ON storage.objects;
CREATE POLICY public_assets_owner_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id IN ('menu-images', 'store-assets')
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

DROP POLICY IF EXISTS public_assets_owner_update ON storage.objects;
CREATE POLICY public_assets_owner_update ON storage.objects
  FOR UPDATE USING (
    bucket_id IN ('menu-images', 'store-assets')
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

DROP POLICY IF EXISTS public_assets_owner_delete ON storage.objects;
CREATE POLICY public_assets_owner_delete ON storage.objects
  FOR DELETE USING (
    bucket_id IN ('menu-images', 'store-assets')
    AND public.get_my_role() = 'owner'
    AND (storage.foldername(name))[1] = public.get_my_business_id()::text
  );

-- ============================================================================
-- KulinerKas - Tabel Modal Usaha (Setoran Awal, Tambah Modal & Prive)
-- Target: Supabase PostgreSQL 15+
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_capital_entries_user_date
  ON public.capital_entries(user_id, entry_date DESC);

DROP TRIGGER IF EXISTS trg_capital_entries_updated_at ON public.capital_entries;
CREATE TRIGGER trg_capital_entries_updated_at
  BEFORE UPDATE ON public.capital_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.capital_entries ENABLE ROW LEVEL SECURITY;

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

-- ============================================================================
-- KulinerKas - Aktifkan Supabase Realtime untuk Sinkronisasi Multi-Akun
-- Opsional & idempoten: aman dijalankan ulang di Supabase SQL Editor.
-- ============================================================================

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'capital_entries',
    'orders',
    'expenses',
    'ingredients',
    'products',
    'profiles'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

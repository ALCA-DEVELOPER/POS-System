-- ============================================================================
-- KulinerKas - Perbaikan penomoran struk POS harian agar aman saat ada transaksi dihapus
-- Menghitung nomor urut berikutnya dari MAX suffix angka hari ini (+ loop anti-duplikat),
-- bukan COUNT(*) yang nilainya bisa turun dan bentrok setelah transaksi dihapus.
-- ============================================================================

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
  v_seq BIGINT;
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

  v_today_key := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext(v_business_id::text || '-' || v_today_key));

  SELECT COALESCE(
    MAX((substring(order_number FROM ('^KK-' || v_today_key || '-([0-9]+)$')))::BIGINT),
    0
  ) + 1
  INTO v_seq
  FROM public.orders
  WHERE user_id = v_business_id
    AND order_number ~ ('^KK-' || v_today_key || '-[0-9]{1,12}$');

  LOOP
    v_order_number := 'KK-' || v_today_key || '-' || lpad(v_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE user_id = v_business_id AND order_number = v_order_number
    );
    v_seq := v_seq + 1;
  END LOOP;

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

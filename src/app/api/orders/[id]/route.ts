import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hapus transaksi POS secara aman (Owner-only):
 * mengembalikan stok bahan baku yang sempat terpotong dan menyesuaikan ekspektasi kas shift.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner" || !profile.is_active) {
    return NextResponse.json(
      { error: "Hanya owner yang dapat menghapus riwayat transaksi" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, user_id, shift_id, payment_method, total_amount, order_number")
    .eq("id", id)
    .eq("user_id", profile.business_id)
    .maybeSingle();

  if (orderErr) {
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Transaksi tidak ditemukan" }, { status: 404 });
  }

  // Kembalikan stok bahan baku yang sempat terpotong untuk order ini
  const { data: movements } = await admin
    .from("stock_movements")
    .select("id, ingredient_id, quantity_delta")
    .eq("user_id", profile.business_id)
    .eq("reference_id", order.id)
    .eq("movement_type", "sale_deduct");

  if (movements && movements.length > 0) {
    const restoreTotals = new Map<string, number>();
    for (const mov of movements) {
      // sale_deduct memiliki quantity_delta negatif, sehingga -quantity_delta adalah jumlah yang dikembalikan
      const addBack = -Number(mov.quantity_delta || 0);
      if (addBack !== 0) {
        restoreTotals.set(
          mov.ingredient_id,
          (restoreTotals.get(mov.ingredient_id) ?? 0) + addBack
        );
      }
    }

    for (const [ingredientId, addBack] of restoreTotals.entries()) {
      const { data: ing } = await admin
        .from("ingredients")
        .select("current_stock")
        .eq("id", ingredientId)
        .eq("user_id", profile.business_id)
        .maybeSingle();

      if (ing) {
        await admin
          .from("ingredients")
          .update({ current_stock: Number(ing.current_stock) + addBack })
          .eq("id", ingredientId);
      }
    }

    await admin
      .from("stock_movements")
      .delete()
      .eq("user_id", profile.business_id)
      .eq("reference_id", order.id)
      .eq("movement_type", "sale_deduct");
  }

  // Sesuaikan ekspektasi kas tunai pada shift jika transaksi dibayar tunai
  if (order.payment_method === "cash" && order.shift_id) {
    const { data: shift } = await admin
      .from("cashier_shifts")
      .select("id, expected_cash, actual_cash")
      .eq("id", order.shift_id)
      .eq("user_id", profile.business_id)
      .maybeSingle();

    if (shift) {
      const nextExpected = Math.max(
        0,
        Number(shift.expected_cash) - Number(order.total_amount)
      );
      const shiftUpdate: { expected_cash: number; cash_difference?: number } = {
        expected_cash: nextExpected,
      };
      if (shift.actual_cash !== null) {
        shiftUpdate.cash_difference = Number(shift.actual_cash) - nextExpected;
      }
      await admin.from("cashier_shifts").update(shiftUpdate).eq("id", shift.id);
    }
  }

  const { error: deleteErr } = await admin
    .from("orders")
    .delete()
    .eq("id", order.id)
    .eq("user_id", profile.business_id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: true,
    order_number: order.order_number,
  });
}

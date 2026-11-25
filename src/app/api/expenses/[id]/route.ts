import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hapus catatan pengeluaran / belanja secara aman (Owner-only):
 * membatalkan penambahan stok dari item belanja terkait serta menghapus file struk di Storage.
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
      { error: "Hanya owner yang dapat menghapus pengeluaran" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: expense, error: expErr } = await admin
    .from("expenses")
    .select("id, user_id, receipt_image_url")
    .eq("id", id)
    .eq("user_id", profile.business_id)
    .maybeSingle();

  if (expErr) {
    return NextResponse.json({ error: expErr.message }, { status: 500 });
  }
  if (!expense) {
    return NextResponse.json({ error: "Catatan pengeluaran tidak ditemukan" }, { status: 404 });
  }

  // Tarik kembali stok yang sebelumnya masuk dari transaksi belanja ini
  const { data: movements } = await admin
    .from("stock_movements")
    .select("id, ingredient_id, quantity_delta")
    .eq("user_id", profile.business_id)
    .eq("reference_id", expense.id)
    .eq("movement_type", "purchase");

  if (movements && movements.length > 0) {
    const revertTotals = new Map<string, number>();
    for (const mov of movements) {
      const added = Number(mov.quantity_delta || 0);
      if (added !== 0) {
        revertTotals.set(
          mov.ingredient_id,
          (revertTotals.get(mov.ingredient_id) ?? 0) + added
        );
      }
    }

    for (const [ingredientId, added] of revertTotals.entries()) {
      const { data: ing } = await admin
        .from("ingredients")
        .select("current_stock")
        .eq("id", ingredientId)
        .eq("user_id", profile.business_id)
        .maybeSingle();

      if (ing) {
        await admin
          .from("ingredients")
          .update({ current_stock: Number(ing.current_stock) - added })
          .eq("id", ingredientId);
      }
    }

    await admin
      .from("stock_movements")
      .delete()
      .eq("user_id", profile.business_id)
      .eq("reference_id", expense.id)
      .eq("movement_type", "purchase");
  }

  if (expense.receipt_image_url) {
    await admin.storage.from("receipts").remove([expense.receipt_image_url]);
  }

  const { error: deleteErr } = await admin
    .from("expenses")
    .delete()
    .eq("id", expense.id)
    .eq("user_id", profile.business_id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}

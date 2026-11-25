import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollbackOrderAndRestoreStock } from "@/lib/server/order-ledger";

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

  try {
    const admin = createAdminClient();
    const removed = await rollbackOrderAndRestoreStock(admin, profile.business_id, id);
    if (!removed) {
      return NextResponse.json({ error: "Transaksi tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      order_number: removed.orderNumber,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghapus transaksi" },
      { status: 500 }
    );
  }
}

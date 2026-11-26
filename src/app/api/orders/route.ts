import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPosOrderViaAdmin } from "@/lib/server/order-ledger";

const createPosOrderSchema = z.object({
  shift_id: z.string().uuid(),
  order_type: z.enum(["dine_in", "takeaway", "online"]).default("dine_in"),
  payment_method: z.enum(["cash", "qris", "transfer"]),
  discount_amount: z.coerce.number().min(0).default(0),
  amount_paid: z.coerce.number().min(0).default(0),
  customer_phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(300).default(""),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(1000),
      })
    )
    .min(1, "Keranjang pesanan masih kosong"),
});

/**
 * Endpoint server-side pencatatan pesanan POS kasir.
 * Dipakai sebagai pengaman agar penomoran struk harian selalu memakai urutan MAX + 1
 * sehingga tidak bentrok ketika ada riwayat transaksi yang sebelumnya dihapus.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "cashier"].includes(profile.role) || !profile.is_active) {
    return NextResponse.json({ error: "Akses kasir ditolak" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createPosOrderSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Data transaksi kasir tidak valid";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const admin = createAdminClient();
    const order = await createPosOrderViaAdmin(admin, {
      businessId: profile.business_id,
      actorId: profile.id,
      shiftId: parsed.data.shift_id,
      orderType: parsed.data.order_type,
      paymentMethod: parsed.data.payment_method,
      discountAmount: parsed.data.discount_amount,
      amountPaid: parsed.data.amount_paid,
      customerPhone: parsed.data.customer_phone ?? null,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal memproses transaksi POS" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recordValidatedCustomerOrderSale,
  rollbackOrderAndRestoreStock,
} from "@/lib/server/order-ledger";
import { resolveCustomerOrderPaymentMethod } from "@/lib/customer-order-payment";

const patchCustomerOrderSchema = z.object({
  action: z.enum(["confirm_paid", "mark_ready", "mark_completed", "reject"]),
});

async function requireTeamAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "cashier"].includes(profile.role) || !profile.is_active) {
    return {
      error: NextResponse.json(
        { error: "Hanya owner atau kasir yang dapat memvalidasi pesanan" },
        { status: 403 }
      ),
    };
  }

  return { profile, admin: createAdminClient() };
}

async function notifyRealtime(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string,
  customerOrderId: string
) {
  try {
    const bizCh = admin.channel(`kulinerkas-biz-${businessId}`);
    const pubCh = admin.channel(`kulinerkas-pub-order-${customerOrderId}`);
    await Promise.all([
      bizCh.httpSend("sync", { scope: "customer_orders", at: Date.now() }),
      pubCh.httpSend("order_update", { orderId: customerOrderId, at: Date.now() }),
    ]);
    await Promise.all([admin.removeChannel(bizCh), admin.removeChannel(pubCh)]);
  } catch {
    // Abaikan kegagalan broadcast sementara
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireTeamAccess();
  if (auth.error) return auth.error;

  const { profile, admin } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = patchCustomerOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Aksi validasi tidak valid" }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await admin
      .from("customer_orders")
      .select("*")
      .eq("id", id)
      .eq("business_id", profile.business_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
    }

    const { action } = parsed.data;
    const nowIso = new Date().toISOString();
    let linkedOrderId: string | null = existing.linked_order_id;

    const updates: Record<string, unknown> = {};

    if (action === "confirm_paid") {
      const actualPaymentMethod = resolveCustomerOrderPaymentMethod(existing);
      if (!linkedOrderId) {
        linkedOrderId = await recordValidatedCustomerOrderSale(admin, {
          businessId: profile.business_id,
          actorId: profile.id,
          productId: existing.product_id,
          productName: existing.product_name,
          quantity: Number(existing.quantity),
          unitPrice: Number(existing.unit_price),
          totalAmount: Number(existing.total_amount),
          customerName: existing.customer_name,
          customerPhone: existing.customer_phone,
          paymentMethod: actualPaymentMethod,
          webOrderNumber: existing.order_number,
        });
      }
      updates.payment_status = "paid";
      updates.paid_verified_at = existing.paid_verified_at ?? nowIso;
      updates.linked_order_id = linkedOrderId;
      if (existing.fulfillment_status === "pending" || existing.fulfillment_status === "cancelled") {
        updates.fulfillment_status = "preparing";
      }
    } else if (action === "mark_ready") {
      updates.fulfillment_status = "ready";
      updates.ready_at = existing.ready_at ?? nowIso;
    } else if (action === "mark_completed") {
      updates.fulfillment_status = "completed";
      if (!existing.ready_at) updates.ready_at = nowIso;
    } else if (action === "reject") {
      if (linkedOrderId) {
        await rollbackOrderAndRestoreStock(admin, profile.business_id, linkedOrderId);
        linkedOrderId = null;
      }
      updates.payment_status = "rejected";
      updates.fulfillment_status = "cancelled";
      updates.linked_order_id = null;
    }

    const { data: updated, error: updateErr } = await admin
      .from("customer_orders")
      .update(updates)
      .eq("id", existing.id)
      .eq("business_id", profile.business_id)
      .select("*")
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: updateErr?.message ?? "Gagal memperbarui status pesanan" },
        { status: 500 }
      );
    }

    await notifyRealtime(admin, profile.business_id, updated.id);
    return NextResponse.json({ order: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal memproses validasi pesanan" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireTeamAccess();
  if (auth.error) return auth.error;

  const { profile, admin } = auth;

  try {
    const { data: existing, error: fetchErr } = await admin
      .from("customer_orders")
      .select("id, linked_order_id")
      .eq("id", id)
      .eq("business_id", profile.business_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
    }

    if (existing.linked_order_id) {
      await rollbackOrderAndRestoreStock(admin, profile.business_id, existing.linked_order_id);
    }

    const { error: delErr } = await admin
      .from("customer_orders")
      .delete()
      .eq("id", existing.id)
      .eq("business_id", profile.business_id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    await notifyRealtime(admin, profile.business_id, existing.id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghapus pesanan" },
      { status: 500 }
    );
  }
}

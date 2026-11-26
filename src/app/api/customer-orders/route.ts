import { NextResponse } from "next/server";
import { z } from "zod";
import { isMissingTableError, toJakartaDateKey } from "@/lib/analytics";
import {
  resolveCustomerOrderDelivery,
  resolveCustomerOrderFulfillmentStatus,
  resolveCustomerOrderPaymentMethod,
} from "@/lib/customer-order-payment";
import { requireTeamAccess } from "@/lib/server/api-auth";
import {
  insertCustomerOrderWithFallback,
  recordValidatedCustomerOrderSale,
} from "@/lib/server/order-ledger";

const createManualCustomerOrderSchema = z.object({
  customer_name: z.string().trim().min(2, "Nama pembeli minimal 2 karakter").max(100),
  customer_phone: z.string().trim().max(25).optional().default(""),
  product_id: z.string().uuid("Pilih menu terlebih dahulu"),
  quantity: z.coerce.number().int().min(1, "Jumlah minimal 1").max(500),
  payment_method: z.enum(["qris", "transfer", "cash"]).default("qris"),
  mark_as_paid: z.boolean().default(true),
  delivery_type: z.enum(["pickup", "delivery"]).default("pickup"),
  delivery_address: z.string().trim().max(400).optional().default(""),
  notes: z.string().trim().max(300).optional().default(""),
});

/**
 * Pencatatan pesanan pembeli manual oleh admin/kasir (misalnya pembeli yang memesan
 * lewat chat WA/DM pribadi tanpa mengisi formulir /pesan).
 */
export async function POST(request: Request) {
  const auth = await requireTeamAccess(
    "Hanya owner atau kasir yang dapat menambah pesanan pembeli"
  );
  if (auth.error) return auth.error;

  const { profile, admin } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createManualCustomerOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data pesanan belum lengkap" },
        { status: 400 }
      );
    }

    const {
      customer_name,
      customer_phone,
      product_id,
      quantity,
      payment_method,
      mark_as_paid,
      delivery_type,
      delivery_address,
      notes,
    } = parsed.data;

    if (delivery_type === "delivery" && delivery_address.trim().length < 5) {
      return NextResponse.json(
        { error: "Mohon isi alamat kos lengkap untuk pengantaran (minimal 5 karakter)." },
        { status: 400 }
      );
    }

    const [{ data: product, error: prodErr }, { data: settingsRow }] = await Promise.all([
      admin
        .from("products")
        .select("id, name, price, is_active")
        .eq("id", product_id)
        .eq("user_id", profile.business_id)
        .maybeSingle(),
      admin
        .from("storefront_settings")
        .select("delivery_fee")
        .eq("business_id", profile.business_id)
        .maybeSingle(),
    ]);

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }
    if (!product || !product.is_active) {
      return NextResponse.json(
        { error: "Menu tidak ditemukan atau sedang nonaktif." },
        { status: 404 }
      );
    }

    const unitPrice = Number(product.price);
    const configuredDeliveryFee =
      settingsRow?.delivery_fee !== null && settingsRow?.delivery_fee !== undefined
        ? Math.max(0, Number(settingsRow.delivery_fee))
        : 1500;
    const deliveryFee = delivery_type === "delivery" ? configuredDeliveryFee : 0;
    const cleanAddress = delivery_type === "delivery" ? delivery_address.trim() : "";
    const totalAmount = unitPrice * quantity + deliveryFee;

    const todayCompact = toJakartaDateKey(new Date()).replace(/-/g, "").slice(2);
    const nowIso = new Date().toISOString();

    let created = null;
    let lastError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      const orderNumber = `WEB-${todayCompact}-${suffix}`;
      const result = await insertCustomerOrderWithFallback(admin, {
        businessId: profile.business_id,
        orderNumber,
        customerName: customer_name,
        customerPhone: customer_phone,
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice,
        totalAmount,
        paymentMethod: payment_method,
        paymentStatus: mark_as_paid ? "paid" : "pending",
        fulfillmentStatus:
          mark_as_paid || payment_method === "cash" ? "preparing" : "pending",
        deliveryType: delivery_type,
        deliveryFee,
        deliveryAddress: cleanAddress,
        notes: notes || "Input manual (Chat Pribadi)",
        paidVerifiedAt: mark_as_paid ? nowIso : null,
      });

      if (result.data && !result.error) {
        created = result.data;
        break;
      }

      lastError = result.error;
      if (result.error?.code !== "23505") {
        break;
      }
    }

    if (!created) {
      if (isMissingTableError(lastError, "customer_orders")) {
        return NextResponse.json(
          { error: "Tabel customer_orders belum dibuat di Supabase." },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: lastError?.message ?? "Gagal menyimpan pesanan pembeli" },
        { status: 500 }
      );
    }

    if (mark_as_paid) {
      try {
        const linkedOrderId = await recordValidatedCustomerOrderSale(admin, {
          businessId: profile.business_id,
          actorId: profile.id,
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice,
          totalAmount,
          customerName: customer_name,
          customerPhone: customer_phone,
          paymentMethod: payment_method,
          deliveryType: delivery_type,
          deliveryFee,
          deliveryAddress: cleanAddress,
          webOrderNumber: created.order_number,
        });

        await admin
          .from("customer_orders")
          .update({ linked_order_id: linkedOrderId })
          .eq("id", created.id)
          .eq("business_id", profile.business_id);

        created = { ...created, linked_order_id: linkedOrderId };
      } catch (ledgerErr) {
        await admin
          .from("customer_orders")
          .delete()
          .eq("id", created.id)
          .eq("business_id", profile.business_id);
        throw ledgerErr;
      }
    }

    try {
      const channel = admin.channel(`kulinerkas-biz-${profile.business_id}`);
      await channel.httpSend("sync", {
        scope: "customer_orders",
        customerOrderId: created.id,
        at: Date.now(),
      });
      if (mark_as_paid) {
        await channel.httpSend("sync", {
          scope: "orders",
          customerOrderId: created.id,
          at: Date.now(),
        });
      }
      await admin.removeChannel(channel);
    } catch {
      // Abaikan jika broadcast gagal; UI lokal & realtime Postgres tetap jalan
    }

    return NextResponse.json(
      {
        order: {
          ...created,
          payment_method: resolveCustomerOrderPaymentMethod(created),
          ...resolveCustomerOrderDelivery(created),
          fulfillment_status: resolveCustomerOrderFulfillmentStatus(created),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menambah pesanan manual" },
      { status: 500 }
    );
  }
}

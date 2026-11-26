import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { toJakartaDateKey, isMissingTableError } from "@/lib/analytics";
import { getPublicStorefrontData } from "@/lib/server/storefront";
import {
  buildFallbackOrderMetaNotes,
  resolveCustomerOrderDelivery,
  resolveCustomerOrderPaymentMethod,
} from "@/lib/customer-order-payment";

const createPublicOrderSchema = z.object({
  customer_name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100),
  customer_phone: z
    .string()
    .trim()
    .min(8, "Nomor WhatsApp / HP minimal 8 digit")
    .max(25),
  quantity: z.number().int().min(1, "Jumlah minimal 1").max(100, "Maksimal 100 paket per order"),
  payment_method: z.enum(["qris", "transfer", "cash"]).optional().default("qris"),
  delivery_type: z.enum(["pickup", "delivery"]).optional().default("pickup"),
  delivery_address: z.string().trim().max(400).optional().default(""),
  notes: z.string().trim().max(300).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createPublicOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data pesanan belum lengkap" },
        { status: 400 }
      );
    }

    const storefront = await getPublicStorefrontData();
    if (!storefront || !storefront.product) {
      return NextResponse.json(
        { error: "Menu pemesanan belum tersedia saat ini" },
        { status: 404 }
      );
    }

    if (storefront.ordersTableMissing) {
      return NextResponse.json(
        { error: "Sistem pesanan online sedang dalam aktivasi awal. Hubungi penjual lewat WhatsApp." },
        { status: 503 }
      );
    }

    if (!storefront.settings.is_open) {
      return NextResponse.json(
        {
          error:
            storefront.settings.closed_message ||
            "Maaf, pemesanan online sedang tutup sementara.",
        },
        { status: 400 }
      );
    }

    const {
      customer_name,
      customer_phone,
      quantity,
      payment_method,
      delivery_type,
      delivery_address,
      notes,
    } = parsed.data;
    if (payment_method === "qris" && !storefront.settings.enable_qris) {
      return NextResponse.json(
        { error: "Pemesanan QRIS lewat web sedang tidak aktif." },
        { status: 400 }
      );
    }
    if (payment_method === "transfer" && !storefront.settings.enable_transfer) {
      return NextResponse.json(
        { error: "Pemesanan Transfer Bank lewat web sedang tidak aktif." },
        { status: 400 }
      );
    }
    if (payment_method === "transfer" && !storefront.bankAccountNumber.trim()) {
      return NextResponse.json(
        { error: "Nomor rekening transfer toko belum diatur." },
        { status: 400 }
      );
    }
    if (payment_method === "cash" && !storefront.settings.enable_cash_chat) {
      return NextResponse.json(
        { error: "Pemesanan Onsite sedang tidak aktif." },
        { status: 400 }
      );
    }
    if (delivery_type === "pickup" && !storefront.settings.enable_pickup) {
      return NextResponse.json(
        { error: "Opsi ambil / COD di lokasi sedang dinonaktifkan." },
        { status: 400 }
      );
    }
    if (delivery_type === "delivery" && !storefront.settings.enable_delivery) {
      return NextResponse.json(
        { error: "Opsi antar ke kos sedang dinonaktifkan." },
        { status: 400 }
      );
    }
    if (delivery_type === "delivery" && delivery_address.trim().length < 5) {
      return NextResponse.json(
        { error: "Mohon isi alamat kos lengkap untuk pengantaran (minimal 5 karakter)." },
        { status: 400 }
      );
    }

    const unitPrice = Number(storefront.product.price);
    const deliveryFee =
      delivery_type === "delivery"
        ? Math.max(0, Number(storefront.settings.delivery_fee ?? 1500))
        : 0;
    const cleanAddress = delivery_type === "delivery" ? delivery_address.trim() : "";
    const totalAmount = unitPrice * quantity + deliveryFee;

    const todayCompact = toJakartaDateKey(new Date()).replace(/-/g, "").slice(2);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `WEB-${todayCompact}-${suffix}`;

    const admin = createAdminClient();
    let { data: created, error } = await admin
      .from("customer_orders")
      .insert({
        business_id: storefront.businessId,
        order_number: orderNumber,
        customer_name,
        customer_phone,
        product_id: storefront.product.id,
        product_name: storefront.product.name,
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        payment_method,
        payment_status: "pending",
        fulfillment_status: "pending",
        delivery_type,
        delivery_fee: deliveryFee,
        delivery_address: cleanAddress,
        notes,
      })
      .select("*")
      .single();

    if (error && !isMissingTableError(error, "customer_orders")) {
      const code = (error as { code?: string }).code ?? "";
      const isSchemaMismatch =
        code === "23514" ||
        code === "42703" ||
        code === "PGRST204" ||
        error.message.includes("customer_orders_payment_method_check") ||
        error.message.includes("delivery_type") ||
        error.message.includes("delivery_fee") ||
        error.message.includes("delivery_address");

      if (isSchemaMismatch) {
        const isMissingDeliveryCols =
          code === "42703" ||
          code === "PGRST204" ||
          error.message.includes("delivery_type") ||
          error.message.includes("delivery_fee") ||
          error.message.includes("delivery_address");

        const fallbackPayload: Record<string, unknown> = {
          business_id: storefront.businessId,
          order_number: orderNumber,
          customer_name,
          customer_phone,
          product_id: storefront.product.id,
          product_name: storefront.product.name,
          quantity,
          unit_price: unitPrice,
          total_amount: totalAmount,
          payment_method: "qris",
          payment_status: "pending",
          fulfillment_status: "pending",
          notes: buildFallbackOrderMetaNotes({
            rawNotes: notes,
            paymentMethod: payment_method,
            deliveryType: delivery_type,
            deliveryFee,
            deliveryAddress: cleanAddress,
          }),
        };

        if (!isMissingDeliveryCols) {
          fallbackPayload.delivery_type = delivery_type;
          fallbackPayload.delivery_fee = deliveryFee;
          fallbackPayload.delivery_address = cleanAddress;
        }

        const retry = await admin
          .from("customer_orders")
          .insert(fallbackPayload)
          .select("*")
          .single();
        created = retry.data;
        error = retry.error;
      }
    }

    if (error || !created) {
      if (isMissingTableError(error, "customer_orders")) {
        return NextResponse.json(
          { error: "Tabel customer_orders belum dibuat di Supabase." },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: error?.message ?? "Gagal menyimpan pesanan" },
        { status: 500 }
      );
    }

    // Pancarkan sinyal real-time langsung ke dashboard admin
    try {
      const channel = admin.channel(`kulinerkas-biz-${storefront.businessId}`);
      await channel.httpSend("sync", { scope: "customer_orders", at: Date.now() });
      await admin.removeChannel(channel);
    } catch {
      // Abaikan jika broadcast gagal; polling/Postgres Realtime tetap berjalan
    }

    return NextResponse.json(
      {
        order: {
          ...created,
          payment_method: resolveCustomerOrderPaymentMethod(created),
          ...resolveCustomerOrderDelivery(created),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

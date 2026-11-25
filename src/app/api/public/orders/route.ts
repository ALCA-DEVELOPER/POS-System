import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { toJakartaDateKey, isMissingTableError } from "@/lib/analytics";
import { getPublicStorefrontData } from "@/lib/server/storefront";
import {
  buildTransferFallbackNotes,
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
  payment_method: z.enum(["qris", "transfer"]).optional().default("qris"),
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

    const { customer_name, customer_phone, quantity, payment_method, notes } = parsed.data;
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

    const unitPrice = Number(storefront.product.price);
    const totalAmount = unitPrice * quantity;

    const todayCompact = toJakartaDateKey(new Date()).replace(/-/g, "").slice(2);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `WEB-${todayCompact}-${suffix}`;

    const selectColumns =
      "id, order_number, customer_name, customer_phone, product_name, quantity, unit_price, total_amount, payment_method, payment_status, fulfillment_status, notes, created_at";

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
        notes,
      })
      .select(selectColumns)
      .single();

    if (
      error &&
      payment_method === "transfer" &&
      ((error as { code?: string }).code === "23514" ||
        error.message.includes("customer_orders_payment_method_check"))
    ) {
      const retry = await admin
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
          payment_method: "qris",
          payment_status: "pending",
          fulfillment_status: "pending",
          notes: buildTransferFallbackNotes(notes),
        })
        .select(selectColumns)
        .single();
      created = retry.data;
      error = retry.error;
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
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

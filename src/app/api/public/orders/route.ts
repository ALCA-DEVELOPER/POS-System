import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { toJakartaDateKey, isMissingTableError } from "@/lib/analytics";
import { getPublicStorefrontData } from "@/lib/server/storefront";

const createPublicOrderSchema = z.object({
  customer_name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100),
  customer_phone: z
    .string()
    .trim()
    .min(8, "Nomor WhatsApp / HP minimal 8 digit")
    .max(25),
  quantity: z.number().int().min(1, "Jumlah minimal 1").max(100, "Maksimal 100 paket per order"),
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

    const { customer_name, customer_phone, quantity, notes } = parsed.data;
    const unitPrice = Number(storefront.product.price);
    const totalAmount = unitPrice * quantity;

    const todayCompact = toJakartaDateKey(new Date()).replace(/-/g, "").slice(2);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `WEB-${todayCompact}-${suffix}`;

    const admin = createAdminClient();
    const { data: created, error } = await admin
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
        notes,
      })
      .select(
        "id, order_number, customer_name, customer_phone, product_name, quantity, unit_price, total_amount, payment_status, fulfillment_status, notes, created_at"
      )
      .single();

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

    return NextResponse.json({ order: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicStorefrontData } from "@/lib/server/storefront";
import { CustomerOrderClient } from "@/components/storefront/CustomerOrderClient";
import type { CustomerOrder } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Pesan Menu | Nummie",
  description: "Pesan menu Nummie dengan pembayaran QRIS mudah tanpa perlu login.",
};

const uuidSchema = z.string().uuid();

export default async function PublicOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const [{ order: orderIdParam }, storefront] = await Promise.all([
    searchParams,
    getPublicStorefrontData(),
  ]);

  let initialOrder: CustomerOrder | null = null;
  if (orderIdParam && uuidSchema.safeParse(orderIdParam).success) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("customer_orders")
      .select(
        "id, business_id, order_number, customer_name, customer_phone, product_id, product_name, quantity, unit_price, total_amount, payment_method, payment_status, fulfillment_status, notes, linked_order_id, paid_verified_at, ready_at, created_at, updated_at"
      )
      .eq("id", orderIdParam)
      .maybeSingle();

    if (data) {
      initialOrder = data as CustomerOrder;
    }
  }

  return <CustomerOrderClient storefront={storefront} initialTrackedOrder={initialOrder} />;
}

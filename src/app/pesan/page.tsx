import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicStorefrontData } from "@/lib/server/storefront";
import { CustomerOrderClient } from "@/components/storefront/CustomerOrderClient";
import {
  resolveCustomerOrderDelivery,
  resolveCustomerOrderPaymentMethod,
} from "@/lib/customer-order-payment";
import type { CustomerOrder } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Pesan Menu | Nummie",
  description:
    "Pesan menu Nummie lewat Langsung Bayar (QRIS / Transfer Bank) atau Onsite via WhatsApp.",
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
      .select("*")
      .eq("id", orderIdParam)
      .maybeSingle();

    if (data) {
      initialOrder = {
        ...(data as CustomerOrder),
        payment_method: resolveCustomerOrderPaymentMethod(data),
        ...resolveCustomerOrderDelivery(data),
      };
    }
  }

  return <CustomerOrderClient storefront={storefront} initialTrackedOrder={initialOrder} />;
}

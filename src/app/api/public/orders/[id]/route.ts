import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveCustomerOrderDelivery,
  resolveCustomerOrderFulfillmentStatus,
  resolveCustomerOrderPaymentMethod,
} from "@/lib/customer-order-payment";

const uuidSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "ID pesanan tidak valid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json({
    order: {
      id: data.id,
      order_number: data.order_number,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      product_name: data.product_name,
      quantity: data.quantity,
      unit_price: data.unit_price,
      total_amount: data.total_amount,
      payment_method: resolveCustomerOrderPaymentMethod(data),
      payment_status: data.payment_status,
      fulfillment_status: resolveCustomerOrderFulfillmentStatus(data),
      notes: data.notes,
      paid_verified_at: data.paid_verified_at,
      ready_at: data.ready_at,
      created_at: data.created_at,
      ...resolveCustomerOrderDelivery(data),
    },
  });
}

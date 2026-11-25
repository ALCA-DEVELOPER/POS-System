import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCustomerOrderPaymentMethod } from "@/lib/customer-order-payment";

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
    .select(
      "id, order_number, customer_name, customer_phone, product_name, quantity, unit_price, total_amount, payment_method, payment_status, fulfillment_status, notes, paid_verified_at, ready_at, created_at"
    )
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
      ...data,
      payment_method: resolveCustomerOrderPaymentMethod(data),
    },
  });
}

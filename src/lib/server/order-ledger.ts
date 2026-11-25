import type { SupabaseClient } from "@supabase/supabase-js";
import { toJakartaDateKey } from "@/lib/analytics";

/**
 * Menghapus transaksi POS beserta itemnya secara aman, mengembalikan stok bahan baku,
 * dan menyesuaikan ekspektasi kas shift jika transaksi dibayar tunai.
 */
export async function rollbackOrderAndRestoreStock(
  admin: SupabaseClient,
  businessId: string,
  orderId: string
): Promise<{ orderNumber: string } | null> {
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, user_id, shift_id, payment_method, total_amount, order_number")
    .eq("id", orderId)
    .eq("user_id", businessId)
    .maybeSingle();

  if (orderErr) {
    throw new Error(orderErr.message);
  }
  if (!order) return null;

  const { data: movements } = await admin
    .from("stock_movements")
    .select("id, ingredient_id, quantity_delta")
    .eq("user_id", businessId)
    .eq("reference_id", order.id)
    .eq("movement_type", "sale_deduct");

  if (movements && movements.length > 0) {
    const restoreTotals = new Map<string, number>();
    for (const mov of movements) {
      const addBack = -Number(mov.quantity_delta || 0);
      if (addBack !== 0) {
        restoreTotals.set(
          mov.ingredient_id,
          (restoreTotals.get(mov.ingredient_id) ?? 0) + addBack
        );
      }
    }

    for (const [ingredientId, addBack] of restoreTotals.entries()) {
      const { data: ing } = await admin
        .from("ingredients")
        .select("current_stock")
        .eq("id", ingredientId)
        .eq("user_id", businessId)
        .maybeSingle();

      if (ing) {
        await admin
          .from("ingredients")
          .update({ current_stock: Number(ing.current_stock) + addBack })
          .eq("id", ingredientId);
      }
    }

    await admin
      .from("stock_movements")
      .delete()
      .eq("user_id", businessId)
      .eq("reference_id", order.id)
      .eq("movement_type", "sale_deduct");
  }

  if (order.payment_method === "cash" && order.shift_id) {
    const { data: shift } = await admin
      .from("cashier_shifts")
      .select("id, expected_cash, actual_cash")
      .eq("id", order.shift_id)
      .eq("user_id", businessId)
      .maybeSingle();

    if (shift) {
      const nextExpected = Math.max(
        0,
        Number(shift.expected_cash) - Number(order.total_amount)
      );
      const shiftUpdate: { expected_cash: number; cash_difference?: number } = {
        expected_cash: nextExpected,
      };
      if (shift.actual_cash !== null) {
        shiftUpdate.cash_difference = Number(shift.actual_cash) - nextExpected;
      }
      await admin.from("cashier_shifts").update(shiftUpdate).eq("id", shift.id);
    }
  }

  const { error: deleteErr } = await admin
    .from("orders")
    .delete()
    .eq("id", order.id)
    .eq("user_id", businessId);

  if (deleteErr) {
    throw new Error(deleteErr.message);
  }

  return { orderNumber: order.order_number };
}

/**
 * Mencatat transaksi penjualan QRIS dari pesanan web pembeli setelah divalidasi admin,
 * menghitung HPP resep, dan memotong stok bahan baku secara atomik.
 */
export async function recordValidatedCustomerOrderSale(
  admin: SupabaseClient,
  params: {
    businessId: string;
    actorId: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    customerName: string;
    customerPhone: string;
    paymentMethod?: "qris" | "transfer";
    webOrderNumber: string;
  }
): Promise<string> {
  const {
    businessId,
    actorId,
    productId,
    productName,
    quantity,
    unitPrice,
    totalAmount,
    customerName,
    customerPhone,
    paymentMethod = "qris",
    webOrderNumber,
  } = params;

  const { data: recipeRows } = await admin
    .from("recipes")
    .select("ingredient_id, quantity_needed, ingredient:ingredients(id, current_stock, cost_per_unit)")
    .eq("product_id", productId);

  let unitHpp = 0;
  const typedRecipes = (recipeRows ?? []) as Array<{
    ingredient_id: string;
    quantity_needed: number;
    ingredient:
      | { id: string; current_stock: number; cost_per_unit: number }
      | Array<{ id: string; current_stock: number; cost_per_unit: number }>
      | null;
  }>;

  for (const r of typedRecipes) {
    const ingObj = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient;
    const ingCost = Number(ingObj?.cost_per_unit ?? 0);
    unitHpp += Number(r.quantity_needed || 0) * ingCost;
  }
  unitHpp = Number(unitHpp.toFixed(2));
  const hppTotal = Number((unitHpp * quantity).toFixed(2));

  const todaySuffix = toJakartaDateKey(new Date()).replace(/-/g, "");
  const randomCode = Math.floor(100 + Math.random() * 900);
  const posOrderNumber = `KK-${todaySuffix}-${webOrderNumber.slice(-3)}-${randomCode}`;

  const { data: createdOrder, error: orderErr } = await admin
    .from("orders")
    .insert({
      user_id: businessId,
      cashier_id: actorId,
      shift_id: null,
      order_number: posOrderNumber,
      subtotal: totalAmount,
      discount_amount: 0,
      tax_amount: 0,
      service_amount: 0,
      total_amount: totalAmount,
      hpp_total: hppTotal,
      amount_paid: totalAmount,
      change_amount: 0,
      payment_method: paymentMethod,
      order_type: "online",
      customer_phone: customerPhone || null,
      notes: customerName ? `${customerName} (${webOrderNumber})` : webOrderNumber,
    })
    .select("id")
    .single();

  if (orderErr || !createdOrder) {
    throw new Error(orderErr?.message ?? "Gagal mencatat penjualan ke pembukuan.");
  }

  const { error: itemErr } = await admin.from("order_items").insert({
    order_id: createdOrder.id,
    product_id: productId,
    product_name: productName,
    quantity,
    unit_price: unitPrice,
    unit_hpp: unitHpp,
    subtotal: totalAmount,
  });

  if (itemErr) {
    await admin.from("orders").delete().eq("id", createdOrder.id);
    throw new Error(itemErr.message);
  }

  for (const r of typedRecipes) {
    const ingObj = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient;
    if (!ingObj) continue;
    const deductQty = Number((Number(r.quantity_needed || 0) * quantity).toFixed(3));
    if (deductQty <= 0) continue;

    await admin
      .from("ingredients")
      .update({ current_stock: Number(ingObj.current_stock) - deductQty })
      .eq("id", ingObj.id)
      .eq("user_id", businessId);

    await admin.from("stock_movements").insert({
      user_id: businessId,
      ingredient_id: ingObj.id,
      actor_id: actorId,
      movement_type: "sale_deduct",
      quantity_delta: -deductQty,
      unit_cost: Number(ingObj.cost_per_unit || 0),
      reference_id: createdOrder.id,
      notes: `Pemakaian pesanan online ${webOrderNumber}`,
    });
  }

  return createdOrder.id;
}

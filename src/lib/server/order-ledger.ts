import type { SupabaseClient } from "@supabase/supabase-js";
import { toJakartaDateKey } from "@/lib/analytics";
import type { OrderType, PaymentMethod } from "@/types/database";

interface RecipeIngredientRow {
  ingredient_id: string;
  quantity_needed: number;
  ingredient:
    | { id: string; current_stock: number; cost_per_unit: number }
    | Array<{ id: string; current_stock: number; cost_per_unit: number }>
    | null;
}

function unwrapIngredient(
  rel: RecipeIngredientRow["ingredient"]
): { id: string; current_stock: number; cost_per_unit: number } | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function isUniqueOrderNumberError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "23505" ||
    Boolean(err.message?.includes("orders_user_id_order_number_key")) ||
    Boolean(err.message?.includes("duplicate key"))
  );
}

async function computeUnitHppMap(
  admin: SupabaseClient,
  productIds: string[]
): Promise<{
  recipesByProduct: Map<string, RecipeIngredientRow[]>;
  unitHppByProduct: Map<string, number>;
}> {
  const uniqueIds = Array.from(new Set(productIds));
  const recipesByProduct = new Map<string, RecipeIngredientRow[]>();
  const unitHppByProduct = new Map<string, number>();

  if (uniqueIds.length === 0) {
    return { recipesByProduct, unitHppByProduct };
  }

  const { data: recipeRows } = await admin
    .from("recipes")
    .select(
      "product_id, ingredient_id, quantity_needed, ingredient:ingredients(id, current_stock, cost_per_unit)"
    )
    .in("product_id", uniqueIds);

  const typed = (recipeRows ?? []) as Array<RecipeIngredientRow & { product_id: string }>;
  for (const row of typed) {
    const list = recipesByProduct.get(row.product_id) ?? [];
    list.push(row);
    recipesByProduct.set(row.product_id, list);

    const ing = unwrapIngredient(row.ingredient);
    const ingCost = Number(ing?.cost_per_unit ?? 0);
    const prev = unitHppByProduct.get(row.product_id) ?? 0;
    unitHppByProduct.set(row.product_id, prev + Number(row.quantity_needed || 0) * ingCost);
  }

  for (const [pid, raw] of unitHppByProduct.entries()) {
    unitHppByProduct.set(pid, Number(raw.toFixed(2)));
  }

  return { recipesByProduct, unitHppByProduct };
}

async function deductStockForOrderItems(
  admin: SupabaseClient,
  params: {
    businessId: string;
    actorId: string;
    orderId: string;
    recipesByProduct: Map<string, RecipeIngredientRow[]>;
    items: Array<{ productId: string; productName: string; quantity: number }>;
    orderNumber: string;
    noteFormat: "pos" | "online";
    webOrderNumber?: string;
  }
) {
  const { businessId, actorId, orderId, recipesByProduct, items, orderNumber, noteFormat, webOrderNumber } =
    params;

  // Lacak stok bahan terbaru di memori agar pengurangan beberapa menu dalam satu transaksi tetap akurat
  const liveStockCache = new Map<string, number>();

  for (const item of items) {
    const recipes = recipesByProduct.get(item.productId) ?? [];
    for (const r of recipes) {
      const ing = unwrapIngredient(r.ingredient);
      if (!ing) continue;

      const deductQty = Number((Number(r.quantity_needed || 0) * item.quantity).toFixed(3));
      if (deductQty <= 0) continue;

      const currentStock = liveStockCache.has(ing.id)
        ? liveStockCache.get(ing.id)!
        : Number(ing.current_stock);
      const nextStock = Number((currentStock - deductQty).toFixed(3));
      liveStockCache.set(ing.id, nextStock);

      await admin
        .from("ingredients")
        .update({ current_stock: nextStock })
        .eq("id", ing.id)
        .eq("user_id", businessId);

      const noteText =
        noteFormat === "online"
          ? `Pemakaian pesanan online ${webOrderNumber ?? orderNumber}`
          : `Penjualan ${orderNumber} (${item.productName} x${item.quantity})`;

      await admin.from("stock_movements").insert({
        user_id: businessId,
        ingredient_id: ing.id,
        actor_id: actorId,
        movement_type: "sale_deduct",
        quantity_delta: -deductQty,
        unit_cost: Number(ing.cost_per_unit || 0),
        reference_id: orderId,
        notes: noteText,
      });
    }
  }
}

async function getNextPosSequence(
  admin: SupabaseClient,
  businessId: string,
  todayKey: string
): Promise<number> {
  const { data } = await admin
    .from("orders")
    .select("order_number")
    .eq("user_id", businessId)
    .like("order_number", `KK-${todayKey}-%`);

  const pattern = new RegExp(`^KK-${todayKey}-(\\d+)$`);
  let maxSeq = 0;
  for (const row of data ?? []) {
    const match = pattern.exec(String((row as { order_number?: string }).order_number ?? ""));
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > maxSeq) {
      maxSeq = n;
    }
  }
  return maxSeq + 1;
}

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
 * Pencatat transaksi kasir POS server-side dengan nomor struk berbasis MAX urutan harian
 * serta retry otomatis jika terjadi bentrok constraint unik.
 */
export async function createPosOrderViaAdmin(
  admin: SupabaseClient,
  params: {
    businessId: string;
    actorId: string;
    shiftId: string;
    orderType: OrderType;
    paymentMethod: PaymentMethod;
    discountAmount: number;
    amountPaid: number;
    customerPhone: string | null;
    notes: string;
    items: Array<{ product_id: string; quantity: number }>;
  }
) {
  const {
    businessId,
    actorId,
    shiftId,
    orderType,
    paymentMethod,
    discountAmount,
    amountPaid,
    customerPhone,
    notes,
    items,
  } = params;

  const { data: shift, error: shiftErr } = await admin
    .from("cashier_shifts")
    .select("id, expected_cash, status")
    .eq("id", shiftId)
    .eq("user_id", businessId)
    .eq("status", "open")
    .maybeSingle();

  if (shiftErr || !shift) {
    throw new Error("Shift kasir belum dibuka atau sudah ditutup");
  }

  const { data: bizProfile } = await admin
    .from("profiles")
    .select("tax_rate, service_charge_rate")
    .eq("id", businessId)
    .maybeSingle();

  const productIds = items.map((i) => i.product_id);
  const { data: productRows, error: prodErr } = await admin
    .from("products")
    .select("id, name, price, is_active")
    .eq("user_id", businessId)
    .eq("is_active", true)
    .in("id", Array.from(new Set(productIds)));

  if (prodErr) {
    throw new Error(prodErr.message);
  }

  const productMap = new Map(
    (productRows ?? []).map((p) => [p.id as string, { id: p.id as string, name: p.name as string, price: Number(p.price) }])
  );

  let subtotal = 0;
  const lineSpecs: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }> = [];

  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product) {
      throw new Error("Menu tidak ditemukan atau tidak aktif");
    }
    const qty = Math.floor(Number(item.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Kuantitas item harus lebih dari 0");
    }
    const lineSubtotal = product.price * qty;
    subtotal += lineSubtotal;
    lineSpecs.push({
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitPrice: product.price,
      subtotal: lineSubtotal,
    });
  }

  const discount = Math.min(Math.max(0, Number(discountAmount || 0)), subtotal);
  const taxable = subtotal - discount;
  const serviceAmount = Math.round(taxable * (Number(bizProfile?.service_charge_rate ?? 0) / 100));
  const taxAmount = Math.round(taxable * (Number(bizProfile?.tax_rate ?? 0) / 100));
  const totalAmount = taxable + serviceAmount + taxAmount;

  const paid = paymentMethod === "cash" ? Number(amountPaid || 0) : totalAmount;
  if (paymentMethod === "cash" && paid < totalAmount) {
    throw new Error("Nominal tunai kurang dari total tagihan");
  }
  const changeAmount = paymentMethod === "cash" ? paid - totalAmount : 0;

  const { recipesByProduct, unitHppByProduct } = await computeUnitHppMap(
    admin,
    lineSpecs.map((l) => l.productId)
  );

  let hppTotal = 0;
  for (const line of lineSpecs) {
    const unitHpp = unitHppByProduct.get(line.productId) ?? 0;
    hppTotal += unitHpp * line.quantity;
  }
  hppTotal = Number(hppTotal.toFixed(2));

  const todayKey = toJakartaDateKey(new Date()).replace(/-/g, "");
  const seq = await getNextPosSequence(admin, businessId, todayKey);

  let createdOrder: {
    id: string;
    order_number: string;
    created_at: string;
  } | null = null;
  let lastInsertErr: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidateOrderNumber = `KK-${todayKey}-${String(seq + attempt).padStart(3, "0")}`;
    const { data, error } = await admin
      .from("orders")
      .insert({
        user_id: businessId,
        cashier_id: actorId,
        shift_id: shift.id,
        order_number: candidateOrderNumber,
        subtotal,
        discount_amount: discount,
        tax_amount: taxAmount,
        service_amount: serviceAmount,
        total_amount: totalAmount,
        hpp_total: hppTotal,
        amount_paid: paid,
        change_amount: changeAmount,
        payment_method: paymentMethod,
        order_type: orderType,
        customer_phone: customerPhone?.trim() ? customerPhone.trim() : null,
        notes: notes.trim(),
      })
      .select("id, order_number, created_at")
      .single();

    if (!error && data) {
      createdOrder = data;
      break;
    }

    lastInsertErr = error;
    if (!isUniqueOrderNumberError(error)) {
      break;
    }
  }

  if (!createdOrder) {
    throw new Error(lastInsertErr?.message ?? "Gagal menyimpan pesanan kasir.");
  }

  const orderItemsPayload = lineSpecs.map((line) => ({
    order_id: createdOrder.id,
    product_id: line.productId,
    product_name: line.productName,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    unit_hpp: unitHppByProduct.get(line.productId) ?? 0,
    subtotal: line.subtotal,
  }));

  const { error: itemErr } = await admin.from("order_items").insert(orderItemsPayload);
  if (itemErr) {
    await admin.from("orders").delete().eq("id", createdOrder.id);
    throw new Error(itemErr.message);
  }

  await deductStockForOrderItems(admin, {
    businessId,
    actorId,
    orderId: createdOrder.id,
    recipesByProduct,
    items: lineSpecs.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
    })),
    orderNumber: createdOrder.order_number,
    noteFormat: "pos",
  });

  if (paymentMethod === "cash") {
    await admin
      .from("cashier_shifts")
      .update({ expected_cash: Number(shift.expected_cash) + totalAmount })
      .eq("id", shift.id);
  }

  return {
    id: createdOrder.id,
    order_number: createdOrder.order_number,
    subtotal,
    discount_amount: discount,
    tax_amount: taxAmount,
    service_amount: serviceAmount,
    total_amount: totalAmount,
    amount_paid: paid,
    change_amount: changeAmount,
    payment_method: paymentMethod,
    order_type: orderType,
    created_at: createdOrder.created_at,
  };
}

/**
 * Mencatat transaksi QRIS/Transfer/Onsite dari pesanan web pembeli setelah divalidasi admin,
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
    paymentMethod?: "qris" | "transfer" | "cash";
    deliveryType?: "pickup" | "delivery";
    deliveryFee?: number;
    deliveryAddress?: string;
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
    deliveryType = "pickup",
    deliveryFee = 0,
    deliveryAddress = "",
    webOrderNumber,
  } = params;

  const { recipesByProduct, unitHppByProduct } = await computeUnitHppMap(admin, [productId]);
  const unitHpp = unitHppByProduct.get(productId) ?? 0;
  const hppTotal = Number((unitHpp * quantity).toFixed(2));

  const todaySuffix = toJakartaDateKey(new Date()).replace(/-/g, "");
  const safeDeliveryFee = Math.max(0, Number(deliveryFee || 0));
  const productSubtotal = Math.max(0, Number(totalAmount) - safeDeliveryFee);
  const deliveryNote =
    deliveryType === "delivery" && deliveryAddress.trim()
      ? ` - Antar Kos: ${deliveryAddress.trim()}`
      : " - COD / Ambil";

  let createdOrder: { id: string; order_number: string } | null = null;
  let lastOrderErr: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const randomCode = Math.floor(100 + Math.random() * 900);
    const posOrderNumber = `KK-${todaySuffix}-${webOrderNumber.slice(-3)}-${randomCode}`;
    const { data, error } = await admin
      .from("orders")
      .insert({
        user_id: businessId,
        cashier_id: actorId,
        shift_id: null,
        order_number: posOrderNumber,
        subtotal: productSubtotal,
        discount_amount: 0,
        tax_amount: 0,
        service_amount: safeDeliveryFee,
        total_amount: totalAmount,
        hpp_total: hppTotal,
        amount_paid: totalAmount,
        change_amount: 0,
        payment_method: paymentMethod,
        order_type: "online",
        customer_phone: customerPhone || null,
        notes: customerName
          ? `${customerName} (${webOrderNumber})${deliveryNote}`
          : `${webOrderNumber}${deliveryNote}`,
      })
      .select("id, order_number")
      .single();

    if (!error && data) {
      createdOrder = data;
      break;
    }

    lastOrderErr = error;
    if (!isUniqueOrderNumberError(error)) {
      break;
    }
  }

  if (!createdOrder) {
    throw new Error(lastOrderErr?.message ?? "Gagal mencatat penjualan ke pembukuan.");
  }

  const { error: itemErr } = await admin.from("order_items").insert({
    order_id: createdOrder.id,
    product_id: productId,
    product_name: productName,
    quantity,
    unit_price: unitPrice,
    unit_hpp: unitHpp,
    subtotal: productSubtotal,
  });

  if (itemErr) {
    await admin.from("orders").delete().eq("id", createdOrder.id);
    throw new Error(itemErr.message);
  }

  await deductStockForOrderItems(admin, {
    businessId,
    actorId,
    orderId: createdOrder.id,
    recipesByProduct,
    items: [{ productId, productName, quantity }],
    orderNumber: createdOrder.order_number,
    noteFormat: "online",
    webOrderNumber,
  });

  return createdOrder.id;
}

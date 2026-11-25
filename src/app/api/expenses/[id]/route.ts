import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const patchExpenseSchema = z.object({
  supplier_name: z.string().trim().max(200),
  description: z.string().trim().max(300),
  category: z.enum(["Bahan Baku", "Kemasan", "Sewa", "Gaji", "Listrik", "Operasional"]),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD"),
  payment_source: z.enum(["cash", "bank", "qris"]),
  tax_amount: z.number().min(0),
  discount_amount: z.number().min(0),
  amount: z.number().min(0),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        item_name: z.string().trim().min(1, "Nama item wajib diisi").max(200),
        quantity: z.number().positive("Jumlah item harus lebih dari 0"),
        unit_price: z.number().min(0),
        subtotal: z.number().min(0),
      })
    )
    .optional(),
});

async function requireOwnerExpenseAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner" || !profile.is_active) {
    return {
      error: NextResponse.json(
        { error: "Hanya owner yang dapat mengubah atau menghapus pengeluaran" },
        { status: 403 }
      ),
    };
  }

  return { profile, admin: createAdminClient() };
}

/**
 * Perbarui catatan pengeluaran beserta harga/jumlah item (Owner-only).
 * Menyesuaikan stok bahan baku dan HPP per unit bila item terhubung ke bahan baku.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireOwnerExpenseAccess();
  if (auth.error) return auth.error;

  const { profile, admin } = auth;

  try {
    const body = await request.json();
    const parsed = patchExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data pembaruan tidak valid" },
        { status: 400 }
      );
    }

    const { data: existingExpense, error: fetchErr } = await admin
      .from("expenses")
      .select("*, expense_items(*)")
      .eq("id", id)
      .eq("user_id", profile.business_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existingExpense) {
      return NextResponse.json({ error: "Catatan pengeluaran tidak ditemukan" }, { status: 404 });
    }

    const input = parsed.data;
    const oldItems = (existingExpense.expense_items ?? []) as Array<{
      id: string;
      ingredient_id: string | null;
      item_name: string;
      quantity: number;
      unit: string;
      stock_conversion_factor: number;
      unit_price: number;
      subtotal: number;
    }>;
    const oldItemMap = new Map(oldItems.map((it) => [it.id, it]));

    let touchedStock = false;

    if (input.items && input.items.length > 0) {
      for (const nextItem of input.items) {
        const oldItem = oldItemMap.get(nextItem.id);
        if (!oldItem) continue;

        const { error: itemErr } = await admin
          .from("expense_items")
          .update({
            item_name: nextItem.item_name,
            quantity: nextItem.quantity,
            unit_price: nextItem.unit_price,
            subtotal: nextItem.subtotal,
          })
          .eq("id", oldItem.id)
          .eq("expense_id", existingExpense.id);

        if (itemErr) {
          return NextResponse.json({ error: itemErr.message }, { status: 500 });
        }

        const qtyChanged = Math.abs(Number(oldItem.quantity) - nextItem.quantity) > 0.0001;
        const subtotalChanged = Math.abs(Number(oldItem.subtotal) - nextItem.subtotal) > 0.01;

        if (oldItem.ingredient_id && (qtyChanged || subtotalChanged)) {
          const factor = Math.max(Number(oldItem.stock_conversion_factor) || 1, 0.0001);
          const oldAdded = Number(oldItem.quantity) * factor;
          const newAdded = nextItem.quantity * factor;
          const oldSub = Number(oldItem.subtotal);
          const newSub = nextItem.subtotal;

          const { data: ing } = await admin
            .from("ingredients")
            .select("id, current_stock, cost_per_unit")
            .eq("id", oldItem.ingredient_id)
            .eq("user_id", profile.business_id)
            .maybeSingle();

          if (ing) {
            const curStock = Number(ing.current_stock);
            const curCost = Number(ing.cost_per_unit);
            const stockWithoutOld = Math.max(0, curStock - oldAdded);
            const valueWithoutOld =
              stockWithoutOld > 0 ? Math.max(0, curStock * curCost - oldSub) : 0;
            const nextStock = stockWithoutOld + newAdded;
            const nextCost =
              nextStock > 0
                ? Number(((valueWithoutOld + newSub) / nextStock).toFixed(4))
                : curCost;

            await admin
              .from("ingredients")
              .update({
                current_stock: nextStock,
                cost_per_unit: Math.max(0, nextCost),
              })
              .eq("id", ing.id);

            const { data: matchingMov } = await admin
              .from("stock_movements")
              .select("id")
              .eq("user_id", profile.business_id)
              .eq("reference_id", existingExpense.id)
              .eq("ingredient_id", ing.id)
              .eq("movement_type", "purchase")
              .limit(1)
              .maybeSingle();

            if (matchingMov) {
              await admin
                .from("stock_movements")
                .update({
                  quantity_delta: newAdded,
                  unit_cost:
                    newAdded > 0 ? Number((newSub / newAdded).toFixed(4)) : 0,
                  notes: `Pembelian dari ${input.supplier_name || "Supplier"} (diperbarui)`,
                })
                .eq("id", matchingMov.id);
            }

            touchedStock = true;
          }
        }
      }
    }

    const { data: updatedExpense, error: updateErr } = await admin
      .from("expenses")
      .update({
        supplier_name: input.supplier_name,
        description: input.description,
        category: input.category,
        expense_date: input.expense_date,
        payment_source: input.payment_source,
        tax_amount: input.tax_amount,
        discount_amount: input.discount_amount,
        amount: input.amount,
      })
      .eq("id", existingExpense.id)
      .eq("user_id", profile.business_id)
      .select("*, expense_items(*)")
      .single();

    if (updateErr || !updatedExpense) {
      return NextResponse.json(
        { error: updateErr?.message ?? "Gagal memperbarui pengeluaran" },
        { status: 500 }
      );
    }

    return NextResponse.json({ expense: updatedExpense, touchedStock });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

/**
 * Hapus catatan pengeluaran / belanja secara aman (Owner-only):
 * membatalkan penambahan stok dari item belanja terkait serta menghapus file struk di Storage.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireOwnerExpenseAccess();
  if (auth.error) return auth.error;

  const { profile, admin } = auth;
  const { data: expense, error: expErr } = await admin
    .from("expenses")
    .select("id, user_id, receipt_image_url")
    .eq("id", id)
    .eq("user_id", profile.business_id)
    .maybeSingle();

  if (expErr) {
    return NextResponse.json({ error: expErr.message }, { status: 500 });
  }
  if (!expense) {
    return NextResponse.json({ error: "Catatan pengeluaran tidak ditemukan" }, { status: 404 });
  }

  // Tarik kembali stok yang sebelumnya masuk dari transaksi belanja ini
  const { data: movements } = await admin
    .from("stock_movements")
    .select("id, ingredient_id, quantity_delta")
    .eq("user_id", profile.business_id)
    .eq("reference_id", expense.id)
    .eq("movement_type", "purchase");

  if (movements && movements.length > 0) {
    const revertTotals = new Map<string, number>();
    for (const mov of movements) {
      const added = Number(mov.quantity_delta || 0);
      if (added !== 0) {
        revertTotals.set(
          mov.ingredient_id,
          (revertTotals.get(mov.ingredient_id) ?? 0) + added
        );
      }
    }

    for (const [ingredientId, added] of revertTotals.entries()) {
      const { data: ing } = await admin
        .from("ingredients")
        .select("current_stock")
        .eq("id", ingredientId)
        .eq("user_id", profile.business_id)
        .maybeSingle();

      if (ing) {
        await admin
          .from("ingredients")
          .update({ current_stock: Number(ing.current_stock) - added })
          .eq("id", ingredientId);
      }
    }

    await admin
      .from("stock_movements")
      .delete()
      .eq("user_id", profile.business_id)
      .eq("reference_id", expense.id)
      .eq("movement_type", "purchase");
  }

  if (expense.receipt_image_url) {
    await admin.storage.from("receipts").remove([expense.receipt_image_url]);
  }

  const { error: deleteErr } = await admin
    .from("expenses")
    .delete()
    .eq("id", expense.id)
    .eq("user_id", profile.business_id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}

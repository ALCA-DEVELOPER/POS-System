import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProductPieceFactors } from "@/lib/analytics";

/**
 * Mengambil rasio jumlah pcs makanan per item menu dari resep aktif bisnis
 * untuk menghitung total pcs terjual harian secara akurat (termasuk paket isi 2+ pcs).
 */
export async function fetchProductPieceFactors(
  supabase: SupabaseClient,
  businessId: string
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("recipes")
    .select(
      "product_id, quantity_needed, product:products!inner(user_id), ingredient:ingredients(name, unit)"
    )
    .eq("product.user_id", businessId);

  return buildProductPieceFactors(
    (data as Array<{
      product_id: string;
      quantity_needed: number | string;
      ingredient:
        | { name?: string | null; unit?: string | null }
        | Array<{ name?: string | null; unit?: string | null }>
        | null;
    }> | null) ?? []
  );
}

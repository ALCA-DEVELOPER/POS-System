import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/analytics";
import type { Product, PublicStorefrontData } from "@/types/database";

/**
 * Mengambil profil toko publik dan 1 menu unggulan ("Paket Lumpia Ubi Ungu (coklat & keju)")
 * untuk halaman pemesanan pembeli tanpa login.
 */
export async function getPublicStorefrontData(): Promise<PublicStorefrontData | null> {
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, business_id, business_name, phone, address, logo_url, qris_image_url, created_at")
    .order("created_at", { ascending: true })
    .limit(20);

  const primaryProfile =
    (profiles ?? []).find((p) => p.id === p.business_id) ?? (profiles ?? [])[0];

  if (!primaryProfile) return null;

  const businessId = primaryProfile.business_id;
  const [{ data: productsRaw }, { error: ordersCheckErr }] = await Promise.all([
    admin
      .from("products")
      .select("id, user_id, name, price, category, image_url, is_active, created_at, updated_at")
      .eq("user_id", businessId)
      .eq("is_active", true)
      .order("price", { ascending: true })
      .order("created_at", { ascending: true }),
    admin.from("customer_orders").select("id").eq("business_id", businessId).limit(1),
  ]);

  const activeProducts = (productsRaw as Product[] | null) ?? [];
  const nonBundleCandidates = activeProducts.filter(
    (p) => !/^\s*[2-9]\d*\s+/i.test(p.name)
  );

  const flagship =
    nonBundleCandidates.find((p) => /ubi ungu/i.test(p.name)) ??
    activeProducts.find((p) => /ubi ungu/i.test(p.name) && Number(p.price) === 7000) ??
    nonBundleCandidates[0] ??
    activeProducts[0] ??
    null;

  return {
    businessId,
    businessName: primaryProfile.business_name || "Nummie",
    phone: primaryProfile.phone || "",
    address: primaryProfile.address || "",
    logoUrl: primaryProfile.logo_url,
    qrisImageUrl: primaryProfile.qris_image_url,
    product: flagship
      ? {
          id: flagship.id,
          name: flagship.name,
          price: Number(flagship.price),
          category: flagship.category,
          image_url: flagship.image_url,
        }
      : null,
    ordersTableMissing: isMissingTableError(ordersCheckErr, "customer_orders"),
  };
}

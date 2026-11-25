import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/analytics";
import type {
  Product,
  PublicStorefrontData,
  StorefrontSettings,
} from "@/types/database";

export function buildDefaultStorefrontSettings(
  businessId: string
): StorefrontSettings {
  return {
    business_id: businessId,
    is_open: true,
    closed_message:
      "Maaf, pemesanan online sedang tutup sementara. Silakan hubungi WhatsApp kami.",
    poster_url: null,
    poster_caption: "",
    announcement: "",
    featured_product_id: null,
    custom_title: "",
    custom_description: "",
    custom_price: null,
    enable_qris: true,
    enable_transfer: true,
    enable_cash_chat: true,
    qris_instruction:
      "Setelah berhasil transfer via QRIS, tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.",
    transfer_instruction:
      "Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.",
    cash_instruction:
      "Untuk menjaga ketersediaan stok, pemesanan onsite (bayar di tempat) langsung dikonfirmasi lewat chat WhatsApp dengan detail pesanan Anda.",
    whatsapp_number: "",
  };
}

/**
 * Mengambil profil toko publik, pengaturan tampilan admin, dan menu unggulan
 * untuk halaman pemesanan pembeli tanpa login (/pesan).
 */
export async function getPublicStorefrontData(): Promise<PublicStorefrontData | null> {
  const admin = createAdminClient();

  const [{ data: profiles }] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, business_id, business_name, phone, address, logo_url, qris_image_url, bank_name, bank_account_number, bank_account_holder, created_at"
      )
      .order("created_at", { ascending: true })
      .limit(20),
  ]);

  const primaryProfile =
    (profiles ?? []).find((p) => p.id === p.business_id) ?? (profiles ?? [])[0];

  if (!primaryProfile) return null;

  const businessId = primaryProfile.business_id;
  const [
    { data: productsRaw },
    { error: ordersCheckErr },
    { data: settingsRow, error: settingsErr },
  ] = await Promise.all([
    admin
      .from("products")
      .select(
        "id, user_id, name, price, category, image_url, is_active, created_at, updated_at"
      )
      .eq("user_id", businessId)
      .eq("is_active", true)
      .order("price", { ascending: true })
      .order("created_at", { ascending: true }),
    admin.from("customer_orders").select("id").eq("business_id", businessId).limit(1),
    admin
      .from("storefront_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const settingsTableMissing = isMissingTableError(
    settingsErr,
    "storefront_settings"
  );
  const defaults = buildDefaultStorefrontSettings(businessId);
  const settings: StorefrontSettings =
    !settingsTableMissing && settingsRow
      ? {
          ...defaults,
          ...(settingsRow as Partial<StorefrontSettings>),
          custom_price:
            settingsRow.custom_price !== null &&
            settingsRow.custom_price !== undefined
              ? Number(settingsRow.custom_price)
              : null,
        }
      : defaults;

  const activeProducts = (productsRaw as Product[] | null) ?? [];
  const nonBundleCandidates = activeProducts.filter(
    (p) => !/^\s*[2-9]\d*\s+/i.test(p.name)
  );

  const flagship =
    (settings.featured_product_id
      ? activeProducts.find((p) => p.id === settings.featured_product_id)
      : null) ??
    nonBundleCandidates.find((p) => /ubi ungu/i.test(p.name)) ??
    activeProducts.find(
      (p) => /ubi ungu/i.test(p.name) && Number(p.price) === 7000
    ) ??
    nonBundleCandidates[0] ??
    activeProducts[0] ??
    null;

  const resolvedTitle = settings.custom_title.trim() || flagship?.name || "";
  const resolvedPrice =
    settings.custom_price !== null && Number.isFinite(settings.custom_price)
      ? Number(settings.custom_price)
      : flagship
        ? Number(flagship.price)
        : 0;

  return {
    businessId,
    businessName: primaryProfile.business_name || "Nummie",
    phone: settings.whatsapp_number.trim() || primaryProfile.phone || "",
    address: primaryProfile.address || "",
    logoUrl: primaryProfile.logo_url,
    qrisImageUrl: primaryProfile.qris_image_url,
    bankName: primaryProfile.bank_name || "",
    bankAccountNumber: primaryProfile.bank_account_number || "",
    bankAccountHolder: primaryProfile.bank_account_holder || "",
    product: flagship
      ? {
          id: flagship.id,
          name: resolvedTitle,
          description: settings.custom_description.trim(),
          price: resolvedPrice,
          category: flagship.category,
          image_url: flagship.image_url,
        }
      : null,
    settings,
    ordersTableMissing: isMissingTableError(ordersCheckErr, "customer_orders"),
    settingsTableMissing,
  };
}

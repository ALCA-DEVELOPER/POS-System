import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/analytics";
import { buildDefaultStorefrontSettings } from "@/lib/server/storefront";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { CustomerOrdersClient } from "@/components/orders/CustomerOrdersClient";
import type {
  CustomerOrder,
  Product,
  StorefrontSettings,
} from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Pesanan Pembeli",
};

export default async function CustomerOrdersPage() {
  const session = await requireSession(["owner", "cashier"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const businessId = session.profile.business_id;
  const isOwner = session.profile.role === "owner";

  const [
    { data: rows, error: ordersErr },
    { data: settingsRow, error: settingsErr },
    { data: productsRaw },
  ] = await Promise.all([
    supabase
      .from("customer_orders")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("storefront_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id, user_id, name, price, category, image_url, is_active, created_at, updated_at")
      .eq("user_id", businessId)
      .order("name", { ascending: true }),
  ]);

  const ordersTableMissing = isMissingTableError(ordersErr, "customer_orders");
  const settingsTableMissing = isMissingTableError(settingsErr, "storefront_settings");
  const tableMissing = ordersTableMissing || settingsTableMissing;

  const initialOrders = ordersTableMissing
    ? []
    : ((rows as CustomerOrder[] | null) ?? []);

  const defaults = buildDefaultStorefrontSettings(businessId);
  const initialSettings: StorefrontSettings =
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

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      logoUrl={session.profile.logo_url}
      pageTitle="Pesanan & Atur Halaman Pembeli"
    >
      <CustomerOrdersClient
        tableMissing={tableMissing}
        isOwner={isOwner}
        businessId={businessId}
        businessName={session.profile.business_name}
        initialOrders={initialOrders}
        initialSettings={initialSettings}
        products={(productsRaw as Product[] | null) ?? []}
      />
    </AppShell>
  );
}

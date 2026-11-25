import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { PosHistoryClient } from "@/components/pos/PosHistoryClient";
import type { Order, StorePosConfig } from "@/types/database";

export const metadata = {
  title: "Riwayat Transaksi POS",
};

export default async function PosHistoryPage() {
  const session = await requireSession(["owner", "cashier"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const isOwner = session.profile.role === "owner";

  const { data: openShift } = await supabase
    .from("cashier_shifts")
    .select("id")
    .eq("cashier_id", session.userId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let ordersQuery = admin
    .from("orders")
    .select(
      "id, order_number, subtotal, discount_amount, tax_amount, service_amount, total_amount, amount_paid, change_amount, payment_method, order_type, customer_phone, notes, created_at, items:order_items(id, product_id, product_name, quantity, unit_price, subtotal)"
    )
    .eq("user_id", session.profile.business_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!isOwner) {
    ordersQuery = ordersQuery.eq("cashier_id", session.userId);
    if (openShift?.id) {
      ordersQuery = ordersQuery.eq("shift_id", openShift.id);
    }
  }

  const [{ data: orders }, { data: storeRows }] = await Promise.all([
    ordersQuery,
    supabase.rpc("get_store_pos_config"),
  ]);

  const storeConfig: StorePosConfig = (storeRows?.[0] as StorePosConfig | undefined) ?? {
    business_id: session.profile.business_id,
    business_name: session.profile.business_name,
    phone: session.profile.phone,
    address: session.profile.address,
    logo_url: session.profile.logo_url,
    qris_image_url: session.profile.qris_image_url,
    bank_name: session.profile.bank_name,
    bank_account_number: session.profile.bank_account_number,
    bank_account_holder: session.profile.bank_account_holder,
    tax_rate: session.profile.tax_rate,
    service_charge_rate: session.profile.service_charge_rate,
  };

  return (
    <AppShell
      role={session.profile.role}
      businessName={storeConfig.business_name || session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Riwayat Transaksi Kasir"
    >
      <PosHistoryClient
        isOwner={isOwner}
        initialOrders={(orders as Order[] | null) ?? []}
        storeConfig={storeConfig}
      />
    </AppShell>
  );
}

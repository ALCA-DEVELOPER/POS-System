import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { PosTerminalClient } from "@/components/pos/PosTerminalClient";
import type { CashierShift, Product, StorePosConfig } from "@/types/database";

export const metadata = {
  title: "Kasir POS",
};

export default async function PosPage() {
  const session = await requireSession(["owner", "cashier"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();

  const [{ data: products }, { data: openShift }, { data: storeRows }] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .eq("user_id", session.profile.business_id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("cashier_shifts")
      .select("*")
      .eq("cashier_id", session.userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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
      pageTitle="Kasir POS"
    >
      <PosTerminalClient
        initialProducts={(products as Product[] | null) ?? []}
        initialShift={(openShift as CashierShift | null) ?? null}
        storeConfig={storeConfig}
      />
    </AppShell>
  );
}

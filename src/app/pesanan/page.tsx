import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/analytics";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { CustomerOrdersClient } from "@/components/orders/CustomerOrdersClient";
import type { CustomerOrder } from "@/types/database";

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
  const { data: rows, error } = await supabase
    .from("customer_orders")
    .select("*")
    .eq("business_id", session.profile.business_id)
    .order("created_at", { ascending: false })
    .limit(150);

  const tableMissing = isMissingTableError(error, "customer_orders");
  const initialOrders = tableMissing
    ? []
    : ((rows as CustomerOrder[] | null) ?? []);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Pesanan Pembeli (Online QRIS)"
    >
      <CustomerOrdersClient
        tableMissing={tableMissing}
        businessName={session.profile.business_name}
        initialOrders={initialOrders}
      />
    </AppShell>
  );
}

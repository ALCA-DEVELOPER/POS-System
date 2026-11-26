import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, toJakartaDateKey } from "@/lib/analytics";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { ReportsClient } from "@/components/reports/ReportsClient";
import type { CapitalEntry, Expense, Order } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Laporan Keuangan",
};

export default async function ReportsPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const today = toJakartaDateKey(new Date());
  const [yr, mo] = today.split("-");
  const monthStart = `${yr}-${mo}-01`;

  const [{ data: orders }, { data: expenses }, { data: capitalRows, error: capitalErr }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", session.profile.business_id)
        .gte("created_at", `${monthStart}T00:00:00+07:00`)
        .lte("created_at", `${today}T23:59:59+07:00`)
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("*")
        .eq("user_id", session.profile.business_id)
        .gte("expense_date", monthStart)
        .lte("expense_date", today)
        .order("expense_date", { ascending: false }),
      supabase
        .from("capital_entries")
        .select("*")
        .eq("user_id", session.profile.business_id)
        .gte("entry_date", monthStart)
        .lte("entry_date", today)
        .order("entry_date", { ascending: false }),
    ]);

  const initialCapitals = isMissingTableError(capitalErr, "capital_entries")
    ? []
    : ((capitalRows as CapitalEntry[] | null) ?? []);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      logoUrl={session.profile.logo_url}
      pendingOrdersCount={session.pendingOrdersCount}
      pageTitle="Laporan Keuangan & Ekspor"
    >
      <ReportsClient
        businessId={session.profile.business_id}
        businessName={session.profile.business_name}
        initialStart={monthStart}
        initialEnd={today}
        initialOrders={(orders as Order[] | null) ?? []}
        initialExpenses={(expenses as Expense[] | null) ?? []}
        initialCapitals={initialCapitals}
      />
    </AppShell>
  );
}

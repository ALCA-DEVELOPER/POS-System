import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { CapitalManagerClient } from "@/components/capital/CapitalManagerClient";
import {
  computeFinancialSummary,
  isMissingTableError,
  toJakartaDateKey,
} from "@/lib/analytics";
import type { CapitalEntry, Expense, Order } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Modal Usaha",
};

export default async function BusinessCapitalPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const businessId = session.profile.business_id;
  const todayKey = toJakartaDateKey(new Date());

  const [{ data: capitalRows, error: capitalErr }, { data: ordersRows }, { data: expensesRows }] =
    await Promise.all([
      supabase
        .from("capital_entries")
        .select("*")
        .eq("user_id", businessId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("orders").select("total_amount, hpp_total").eq("user_id", businessId),
      supabase.from("expenses").select("amount, category").eq("user_id", businessId),
    ]);

  const capitalTableMissing = isMissingTableError(capitalErr, "capital_entries");
  const initialEntries = capitalTableMissing
    ? []
    : ((capitalRows as CapitalEntry[] | null) ?? []);

  const allOrders = (ordersRows as Array<Pick<Order, "total_amount" | "hpp_total">> | null) ?? [];
  const allExpenses = (expensesRows as Array<Pick<Expense, "amount" | "category">> | null) ?? [];
  const summary = computeFinancialSummary(allOrders, allExpenses);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      logoUrl={session.profile.logo_url}
      pageTitle="Modal Usaha & Balik Modal"
    >
      <CapitalManagerClient
        businessId={businessId}
        todayKey={todayKey}
        capitalTableMissing={capitalTableMissing}
        initialEntries={initialEntries}
        allTimeSales={summary.revenue}
        allTimeExpenses={summary.totalExpenses}
        allTimeNetProfit={summary.netProfit}
      />
    </AppShell>
  );
}

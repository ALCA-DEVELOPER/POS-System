import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import {
  computeCapitalSummary,
  isMissingTableError,
  toJakartaDateKey,
} from "@/lib/analytics";
import type { CapitalEntry, Expense, Ingredient, Order, OrderItem } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Dashboard Keuangan",
};

export default async function DashboardPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const businessId = session.profile.business_id;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 30);
  const sinceIso = sinceDate.toISOString();
  const sinceDateStr = toJakartaDateKey(sinceDate);
  const todayKey = toJakartaDateKey(new Date());

  const [
    { data: orders30d },
    { data: expenses30d },
    { data: ingredients },
    { data: allOrdersTotals },
    { data: allExpensesTotals },
    { data: capitalRows, error: capitalErr },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*, items:order_items(*)")
      .eq("user_id", businessId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("*")
      .eq("user_id", businessId)
      .gte("expense_date", sinceDateStr)
      .order("expense_date", { ascending: false }),
    supabase
      .from("ingredients")
      .select("*")
      .eq("user_id", businessId)
      .order("name", { ascending: true }),
    supabase.from("orders").select("total_amount").eq("user_id", businessId),
    supabase.from("expenses").select("amount").eq("user_id", businessId),
    supabase.from("capital_entries").select("entry_type, amount").eq("user_id", businessId),
  ]);

  const totalSalesAllTime = (allOrdersTotals ?? []).reduce(
    (s, r) => s + Number(r.total_amount || 0),
    0
  );
  const totalExpensesAllTime = (allExpensesTotals ?? []).reduce(
    (s, r) => s + Number(r.amount || 0),
    0
  );
  const capitalMissing = isMissingTableError(capitalErr, "capital_entries");
  const capitalEntries = capitalMissing
    ? []
    : ((capitalRows as Array<Pick<CapitalEntry, "entry_type" | "amount">> | null) ?? []);
  const { netCapital } = computeCapitalSummary(capitalEntries);
  const actualCashBalance = netCapital + totalSalesAllTime - totalExpensesAllTime;

  const hydratedOrders = (orders30d as Array<Order & { items?: OrderItem[] }> | null) ?? [];
  const orderItems30d = hydratedOrders.flatMap((o) => o.items ?? []);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Ringkasan Keuangan Usaha"
    >
      <DashboardClient
        todayKey={todayKey}
        netCapital={netCapital}
        totalSalesAllTime={totalSalesAllTime}
        totalExpensesAllTime={totalExpensesAllTime}
        actualCashBalance={actualCashBalance}
        orders30d={hydratedOrders}
        orderItems30d={orderItems30d}
        expenses30d={(expenses30d as Expense[] | null) ?? []}
        ingredients={(ingredients as Ingredient[] | null) ?? []}
      />
    </AppShell>
  );
}

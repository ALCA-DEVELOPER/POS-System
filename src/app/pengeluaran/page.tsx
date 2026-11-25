import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { ExpensesListClient } from "@/components/expenses/ExpensesListClient";
import type { Expense } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Daftar Pengeluaran",
};

export default async function ExpensesPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select("*, expense_items(*)")
    .eq("user_id", session.profile.business_id)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Catatan Pengeluaran & Belanja"
    >
      <ExpensesListClient initialExpenses={(data as Expense[] | null) ?? []} />
    </AppShell>
  );
}

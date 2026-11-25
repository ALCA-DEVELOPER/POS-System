import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { ScanReceiptClient } from "@/components/expenses/ScanReceiptClient";
import type { Ingredient } from "@/types/database";

export const metadata = {
  title: "Scan Struk Belanja",
};

export default async function ScanReceiptPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("*")
    .eq("user_id", session.profile.business_id)
    .order("name", { ascending: true });

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Scan Struk Belanja"
    >
      <ScanReceiptClient
        businessId={session.profile.business_id}
        ingredients={(ingredients as Ingredient[] | null) ?? []}
      />
    </AppShell>
  );
}

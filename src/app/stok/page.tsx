import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { StockManagerClient } from "@/components/stock/StockManagerClient";
import type { Ingredient, KitchenIngredient, StockMovement } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Stok Bahan Baku",
};

export default async function StockPage() {
  const session = await requireSession(["owner", "kitchen"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();
  const isOwner = session.profile.role === "owner";

  let ingredients: Array<Ingredient | KitchenIngredient> = [];
  if (isOwner) {
    const { data } = await supabase
      .from("ingredients")
      .select("*")
      .eq("user_id", session.profile.business_id)
      .order("name", { ascending: true });
    ingredients = (data as Ingredient[] | null) ?? [];
  } else {
    const { data } = await supabase.rpc("get_kitchen_ingredients");
    ingredients = (data as KitchenIngredient[] | null) ?? [];
  }

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("*, ingredient:ingredients(name, unit)")
    .eq("user_id", session.profile.business_id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      logoUrl={session.profile.logo_url}
      pageTitle="Stok Bahan Baku & Kemasan"
    >
      <StockManagerClient
        role={session.profile.role}
        businessId={session.profile.business_id}
        initialIngredients={ingredients}
        initialMovements={(movements as StockMovement[] | null) ?? []}
      />
    </AppShell>
  );
}

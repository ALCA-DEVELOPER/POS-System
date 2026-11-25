import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import { MenuHppClient } from "@/components/menu/MenuHppClient";
import type { Ingredient, ProductWithHpp } from "@/types/database";

export const metadata = {
  title: "Menu & Resep HPP",
};

export default async function MenuPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const supabase = await createClient();

  const [{ data: productsRaw }, { data: ingredientsRaw }] = await Promise.all([
    supabase
      .from("products")
      .select("*, recipes(*, ingredient:ingredients(*))")
      .eq("user_id", session.profile.business_id)
      .order("name", { ascending: true }),
    supabase
      .from("ingredients")
      .select("*")
      .eq("user_id", session.profile.business_id)
      .order("name", { ascending: true }),
  ]);

  const products: ProductWithHpp[] = (productsRaw ?? []).map((p) => {
    const recipes = (p.recipes ?? []) as ProductWithHpp["recipes"];
    const hpp = recipes.reduce((sum, r) => {
      const unitCost = Number(r.ingredient?.cost_per_unit ?? 0);
      return sum + Number(r.quantity_needed) * unitCost;
    }, 0);
    const sellPrice = Number(p.price);
    const marginAmt = sellPrice - hpp;
    const marginPct = sellPrice > 0 ? (marginAmt / sellPrice) * 100 : 0;
    return {
      ...p,
      recipes,
      hpp,
      gross_margin_amount: marginAmt,
      gross_margin_percent: marginPct,
    };
  });

  return (
    <AppShell
      role={session.profile.role}
      businessName={session.profile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Menu Jual & Kalkulasi HPP"
    >
      <MenuHppClient
        businessId={session.profile.business_id}
        initialProducts={products}
        ingredients={(ingredientsRaw as Ingredient[] | null) ?? []}
      />
    </AppShell>
  );
}

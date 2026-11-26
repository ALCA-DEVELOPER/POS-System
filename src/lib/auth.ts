import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, UserRole } from "@/types/database";

/** Default landing route per role. */
export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case "cashier":
      return "/pos";
    case "kitchen":
      return "/stok";
    case "owner":
    default:
      return "/dashboard";
  }
}

export interface SessionContext {
  userId: string;
  email: string;
  profile: Profile | null;
  pendingOrdersCount: number;
  schemaMissing: boolean;
}

/**
 * Load authenticated user and their business profile on the server.
 * Redirects to /login if unauthenticated.
 */
export async function requireSession(allowedRoles?: UserRole[]): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    const code = (profileError as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01" || profileError.message.includes("profiles")) {
      return {
        userId: user.id,
        email: user.email ?? "",
        profile: null,
        pendingOrdersCount: 0,
        schemaMissing: true,
      };
    }
  }

  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=akun_nonaktif");
  }

  let resolvedProfile = (profile as Profile | null) ?? null;

  // Gabungkan identitas & branding usaha induk agar co-owner, kasir, dan staf dapur selalu melihat logo & info toko terbaru.
  if (
    resolvedProfile &&
    resolvedProfile.business_id &&
    resolvedProfile.business_id !== resolvedProfile.id
  ) {
    try {
      const admin = createAdminClient();
      const { data: businessProfile } = await admin
        .from("profiles")
        .select(
          "business_name, owner_name, phone, address, logo_url, qris_image_url, bank_name, bank_account_number, bank_account_holder, tax_rate, service_charge_rate"
        )
        .eq("id", resolvedProfile.business_id)
        .maybeSingle();

      if (businessProfile) {
        resolvedProfile = {
          ...resolvedProfile,
          ...businessProfile,
        };
      }
    } catch {
      // Tetap gunakan profil akun saat env admin belum tersedia
    }
  }

  const role = resolvedProfile?.role ?? "owner";
  if (allowedRoles && !allowedRoles.includes(role)) {
    redirect(getDefaultRouteForRole(role));
  }

  let pendingOrdersCount = 0;
  if (resolvedProfile && ["owner", "cashier"].includes(role)) {
    try {
      const admin = createAdminClient();
      const { count } = await admin
        .from("customer_orders")
        .select("id", { count: "exact", head: true })
        .eq("business_id", resolvedProfile.business_id)
        .neq("payment_status", "rejected")
        .in("fulfillment_status", ["pending", "preparing", "ready", "shipping"]);
      pendingOrdersCount = count ?? 0;
    } catch {
      pendingOrdersCount = 0;
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: resolvedProfile,
    pendingOrdersCount,
    schemaMissing: false,
  };
}

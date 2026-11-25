import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
        schemaMissing: true,
      };
    }
  }

  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=akun_nonaktif");
  }

  const role = (profile?.role as UserRole | undefined) ?? "owner";
  if (allowedRoles && !allowedRoles.includes(role)) {
    redirect(getDefaultRouteForRole(role));
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: (profile as Profile | null) ?? null,
    schemaMissing: false,
  };
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requireTeamAccess(forbiddenMessage = "Akses ditolak") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "cashier"].includes(profile.role) || !profile.is_active) {
    return { error: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) };
  }

  return { profile, admin: createAdminClient() };
}

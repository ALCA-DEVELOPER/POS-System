import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/layout/AppShell";
import { SchemaMissingNotice } from "@/components/ui/SchemaMissingNotice";
import {
  BusinessSettingsClient,
  type StaffMember,
} from "@/components/settings/BusinessSettingsClient";
import type { Profile } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Pengaturan Bisnis",
};

export default async function BusinessSettingsPage() {
  const session = await requireSession(["owner"]);
  if (session.schemaMissing || !session.profile) {
    return <SchemaMissingNotice />;
  }

  const admin = createAdminClient();
  const [{ data: businessProfile }, { data: staffRows }, { data: usersData }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("*")
        .eq("id", session.profile.business_id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("id, full_name, role, phone, is_active, created_at")
        .eq("business_id", session.profile.business_id)
        .neq("id", session.profile.id)
        .order("created_at", { ascending: false }),
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);

  const emailMap = new Map(
    (usersData?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  const enrichedStaff: StaffMember[] = (staffRows ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    phone: row.phone,
    email: emailMap.get(row.id) ?? "",
    is_active: row.is_active,
    created_at: row.created_at,
  }));

  const sharedProfile = (businessProfile as Profile | null) ?? session.profile;

  return (
    <AppShell
      role={session.profile.role}
      businessName={sharedProfile.business_name}
      userName={session.profile.full_name || session.profile.owner_name}
      pageTitle="Pengaturan Bisnis & Staf"
    >
      <BusinessSettingsClient
        initialProfile={sharedProfile}
        initialStaff={enrichedStaff}
        currentUserId={session.userId}
        currentUserEmail={session.email}
      />
    </AppShell>
  );
}

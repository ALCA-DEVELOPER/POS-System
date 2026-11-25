import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") ?? "";

  if (!path) {
    return NextResponse.json({ error: "Path struk diperlukan" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }

  // Enforce strict tenant folder prefix before generating signed URL
  if (!path.startsWith(`${profile.business_id}/`)) {
    return NextResponse.json({ error: "Struk bukan milik usaha ini" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("receipts")
    .createSignedUrl(path, 300);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Gagal memuat foto struk" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: data.signedUrl });
}

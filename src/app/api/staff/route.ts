import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const createStaffSchema = z.object({
  full_name: z.string().trim().min(2, "Nama staf minimal 2 karakter"),
  email: z.string().trim().email("Format email tidak valid"),
  password: z.string().min(8, "Kata sandi minimal 8 karakter"),
  phone: z.string().trim().optional().default(""),
  role: z.enum(["owner", "cashier", "kitchen"]),
});

async function requireOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner" || !profile.is_active) {
    return { error: NextResponse.json({ error: "Hanya owner yang dapat mengelola staf" }, { status: 403 }) };
  }

  return { profile };
}

export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const [{ data, error }, { data: usersData }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, phone, is_active, created_at")
      .eq("business_id", auth.profile.business_id)
      .neq("id", auth.profile.id)
      .order("created_at", { ascending: false }),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const emailMap = new Map(
    (usersData?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  const enriched = (data ?? []).map((member) => ({
    ...member,
    email: emailMap.get(member.id) ?? "",
  }));

  return NextResponse.json({ staff: enriched });
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createStaffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data staf tidak valid" },
        { status: 400 }
      );
    }

    const { full_name, email, password, phone, role } = parsed.data;
    const admin = createAdminClient();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        business_id: auth.profile.business_id,
        role,
      },
      user_metadata: {
        business_name: auth.profile.business_name,
        owner_name: auth.profile.owner_name,
        full_name,
        phone,
      },
    });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "Gagal membuat akun staf" },
        { status: 400 }
      );
    }

    await admin
      .from("profiles")
      .update({
        business_name: auth.profile.business_name,
        owner_name: auth.profile.owner_name,
        full_name,
        phone,
        role,
      })
      .eq("id", created.user.id);

    return NextResponse.json(
      {
        staff: {
          id: created.user.id,
          full_name,
          role,
          phone,
          email,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

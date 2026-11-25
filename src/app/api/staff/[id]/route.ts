import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const patchStaffSchema = z.object({
  full_name: z.string().trim().min(2, "Nama minimal 2 karakter").optional(),
  phone: z.string().trim().optional(),
  is_active: z.boolean().optional(),
  role: z.enum(["owner", "cashier", "kitchen"]).optional(),
  password: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 8, "Kata sandi baru minimal 8 karakter"),
});

async function requireOwnerAndTarget(staffId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 }) };
  }

  const { data: owner } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!owner || owner.role !== "owner" || !owner.is_active) {
    return { error: NextResponse.json({ error: "Hanya owner yang dapat mengubah staf" }, { status: 403 }) };
  }

  if (staffId === owner.id) {
    return {
      error: NextResponse.json(
        { error: "Tidak dapat mengubah akun sendiri dari menu staf" },
        { status: 400 }
      ),
    };
  }

  if (staffId === owner.business_id) {
    return {
      error: NextResponse.json(
        { error: "Akun pemilik utama bisnis tidak dapat diubah atau dihapus oleh akun lain" },
        { status: 403 }
      ),
    };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("*")
    .eq("id", staffId)
    .eq("business_id", owner.business_id)
    .maybeSingle();

  if (!target) {
    return { error: NextResponse.json({ error: "Staf tidak ditemukan" }, { status: 404 }) };
  }

  return { owner, target, admin };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const check = await requireOwnerAndTarget(id);
  if (check.error) return check.error;

  try {
    const body = await request.json();
    const parsed = patchStaffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data pembaruan tidak valid" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.full_name !== undefined) updates.full_name = parsed.data.full_name;
    if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
    if (typeof parsed.data.is_active === "boolean") updates.is_active = parsed.data.is_active;
    if (parsed.data.role) updates.role = parsed.data.role;

    const { data, error } = await check.admin
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .select("id, full_name, role, phone, is_active, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const authUpdates: {
      app_metadata?: { business_id: string; role: string };
      user_metadata?: { full_name?: string; phone?: string };
      password?: string;
    } = {};

    if (parsed.data.role) {
      authUpdates.app_metadata = {
        business_id: check.owner.business_id,
        role: parsed.data.role,
      };
    }

    if (parsed.data.full_name !== undefined || parsed.data.phone !== undefined) {
      authUpdates.user_metadata = {
        ...(parsed.data.full_name !== undefined ? { full_name: parsed.data.full_name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      };
    }

    if (parsed.data.password) {
      authUpdates.password = parsed.data.password;
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authErr } = await check.admin.auth.admin.updateUserById(id, authUpdates);
      if (authErr) {
        return NextResponse.json({ error: authErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ staff: data });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const check = await requireOwnerAndTarget(id);
  if (check.error) return check.error;

  const businessId = check.owner.business_id;

  // Pindahkan referensi historis ke pemilik utama agar bebas ON DELETE RESTRICT
  await Promise.all([
    check.admin
      .from("orders")
      .update({ cashier_id: businessId })
      .eq("user_id", businessId)
      .eq("cashier_id", id),
    check.admin
      .from("cashier_shifts")
      .update({ cashier_id: businessId })
      .eq("user_id", businessId)
      .eq("cashier_id", id),
    check.admin
      .from("stock_movements")
      .update({ actor_id: null })
      .eq("user_id", businessId)
      .eq("actor_id", id),
  ]);

  const { error } = await check.admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}

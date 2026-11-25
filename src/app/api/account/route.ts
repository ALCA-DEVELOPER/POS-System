import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const deleteAccountSchema = z.object({
  confirmation: z.literal("HAPUS PERMANEN"),
});

async function clearBucketFolder(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  folder: string
) {
  const { data: files } = await admin.storage.from(bucket).list(folder, {
    limit: 1000,
  });
  if (files && files.length > 0) {
    const paths = files.map((f) => `${folder}/${f.name}`);
    await admin.storage.from(bucket).remove(paths);
  }
}

/**
 * Hapus akun pengguna secara permanen dari DB, Storage, dan Supabase Auth.
 * - Jika Pemilik Utama (id === business_id): menghapus 100% seluruh data bisnis, foto struk/aset,
 *   akun staf/co-owner terkait, dan akun pemilik utama sehingga email dapat dipakai daftar lagi.
 * - Jika anggota tim (Co-Owner/Kasir/Dapur): memindahkan referensi kasir/shift historis ke pemilik utama
 *   lalu menghapus akun pribadi anggota tersebut.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Ketik "HAPUS PERMANEN" untuk mengonfirmasi penghapusan akun.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, business_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      // Fallback: jika row profiles tidak ada, hapus langsung user Auth agar email bebas
      await admin.auth.admin.deleteUser(user.id);
      await supabase.auth.signOut();
      return NextResponse.json({ deleted: true, scope: "auth_only" });
    }

    const businessId = profile.business_id;
    const isPrimaryFounder = profile.id === businessId;

    if (isPrimaryFounder) {
      // 1. Bersihkan seluruh file di Supabase Storage milik bisnis ini
      await Promise.all([
        clearBucketFolder(admin, "receipts", businessId),
        clearBucketFolder(admin, "menu-images", businessId),
        clearBucketFolder(admin, "store-assets", businessId),
      ]);

      // 2. Bersihkan tabel anak ke induk secara berurutan agar bebas constraint ON DELETE RESTRICT
      await admin.from("capital_entries").delete().eq("user_id", businessId);
      await admin.from("stock_movements").delete().eq("user_id", businessId);
      await admin.from("expenses").delete().eq("user_id", businessId);
      await admin.from("orders").delete().eq("user_id", businessId);
      await admin.from("cashier_shifts").delete().eq("user_id", businessId);
      await admin.from("products").delete().eq("user_id", businessId);
      await admin.from("ingredients").delete().eq("user_id", businessId);

      // 3. Hapus seluruh akun tim lain dalam bisnis ini terlebih dahulu
      const { data: teamProfiles } = await admin
        .from("profiles")
        .select("id")
        .eq("business_id", businessId)
        .neq("id", user.id);

      if (teamProfiles && teamProfiles.length > 0) {
        for (const member of teamProfiles) {
          await admin.auth.admin.deleteUser(member.id);
        }
      }

      // 4. Hapus akun Auth pemilik utama (cascade ke row profiles terakhir & bebaskan email)
      const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 });
      }

      await supabase.auth.signOut();
      return NextResponse.json({ deleted: true, scope: "full_business" });
    }

    // Kasus Co-Owner / Staf menghapus akun pribadinya sendiri:
    // pindahkan FK RESTRICT historis ke pemilik utama bisnis terlebih dahulu
    await Promise.all([
      admin
        .from("orders")
        .update({ cashier_id: businessId })
        .eq("user_id", businessId)
        .eq("cashier_id", user.id),
      admin
        .from("cashier_shifts")
        .update({ cashier_id: businessId })
        .eq("user_id", businessId)
        .eq("cashier_id", user.id),
      admin
        .from("stock_movements")
        .update({ actor_id: null })
        .eq("user_id", businessId)
        .eq("actor_id", user.id),
    ]);

    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    await supabase.auth.signOut();
    return NextResponse.json({ deleted: true, scope: "personal_account" });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat menghapus akun.",
      },
      { status: 500 }
    );
  }
}

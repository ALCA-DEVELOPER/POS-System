import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/analytics";

const updateStorefrontSchema = z.object({
  is_open: z.boolean(),
  closed_message: z.string().trim().max(400),
  poster_url: z.string().trim().max(1000).nullable(),
  poster_caption: z.string().trim().max(300),
  announcement: z.string().trim().max(400),
  featured_product_id: z.string().uuid().nullable(),
  custom_title: z.string().trim().max(150),
  custom_description: z.string().trim().max(500),
  custom_price: z.number().min(0).nullable(),
  enable_qris: z.boolean(),
  enable_transfer: z.boolean().optional().default(true),
  enable_cash_chat: z.boolean(),
  qris_instruction: z.string().trim().max(500),
  transfer_instruction: z
    .string()
    .trim()
    .max(500)
    .optional()
    .default(
      "Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda."
    ),
  cash_instruction: z.string().trim().max(500),
  whatsapp_number: z.string().trim().max(30),
});

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner" || !profile.is_active) {
    return NextResponse.json(
      { error: "Hanya owner yang dapat mengatur halaman pembeli" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = updateStorefrontSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    let { data: saved, error } = await admin
      .from("storefront_settings")
      .upsert(
        {
          business_id: profile.business_id,
          ...parsed.data,
        },
        { onConflict: "business_id" }
      )
      .select("*")
      .single();

    if (
      error &&
      (error.message.includes("enable_transfer") ||
        error.message.includes("transfer_instruction"))
    ) {
      const {
        enable_transfer: omittedEnableTransfer,
        transfer_instruction: omittedTransferInstruction,
        ...legacyData
      } = parsed.data;
      const retry = await admin
        .from("storefront_settings")
        .upsert(
          {
            business_id: profile.business_id,
            ...legacyData,
          },
          { onConflict: "business_id" }
        )
        .select("*")
        .single();
      saved = retry.data
        ? {
            ...retry.data,
            enable_transfer: omittedEnableTransfer,
            transfer_instruction: omittedTransferInstruction,
          }
        : null;
      error = retry.error;
    }

    if (error || !saved) {
      if (isMissingTableError(error, "storefront_settings")) {
        return NextResponse.json(
          { error: "Tabel storefront_settings belum dibuat di Supabase." },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: error?.message ?? "Gagal menyimpan pengaturan halaman pembeli" },
        { status: 500 }
      );
    }

    // Pancarkan update real-time ke halaman pembeli & admin tim lain
    try {
      const bizCh = admin.channel(`kulinerkas-biz-${profile.business_id}`);
      const pubCh = admin.channel(`kulinerkas-storefront-${profile.business_id}`);
      await Promise.all([
        bizCh.httpSend("sync", { scope: "settings", at: Date.now() }),
        pubCh.httpSend("storefront_update", { at: Date.now() }),
      ]);
      await Promise.all([admin.removeChannel(bizCh), admin.removeChannel(pubCh)]);
    } catch {
      // Abaikan kegagalan broadcast sementara
    }

    return NextResponse.json({ settings: saved });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }
}

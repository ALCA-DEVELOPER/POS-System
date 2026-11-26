import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { toJakartaDateKey } from "@/lib/analytics";
import type { Ingredient, IngredientUnit } from "@/types/database";

export const maxDuration = 60;

const receiptSchema = {
  type: Type.OBJECT,
  properties: {
    supplier_name: { type: Type.STRING, description: "Nama toko, pasar, atau supplier pada struk" },
    receipt_date: {
      type: Type.STRING,
      description: "Tanggal belanja dalam format YYYY-MM-DD, kosongkan jika tidak terlihat",
    },
    predicted_category: {
      type: Type.STRING,
      enum: ["Bahan Baku", "Kemasan", "Sewa", "Gaji", "Listrik", "Operasional"],
      description: "Kategori pengeluaran paling sesuai untuk mayoritas item pada struk",
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item_name: { type: Type.STRING, description: "Nama barang yang rapi dan mudah dipahami" },
          quantity: { type: Type.NUMBER, description: "Jumlah kuantitas beli" },
          unit: { type: Type.STRING, description: "Satuan beli di struk, misal kg, gram, liter, ml, pcs, pack, dus" },
          unit_price: { type: Type.NUMBER, description: "Harga satuan dalam Rupiah (angka bulat)" },
          subtotal: { type: Type.NUMBER, description: "Total harga baris item ini dalam Rupiah" },
        },
        required: ["item_name", "quantity", "unit", "unit_price", "subtotal"],
      },
    },
    tax_amount: { type: Type.NUMBER, description: "Total PPN / pajak dalam Rupiah, 0 jika tidak ada" },
    discount_amount: { type: Type.NUMBER, description: "Total diskon atau potongan harga dalam Rupiah, 0 jika tidak ada" },
    total_amount: { type: Type.NUMBER, description: "Total akhir yang dibayar dalam Rupiah" },
    confidence_notes: {
      type: Type.STRING,
      description: "Catatan singkat jika ada bagian struk yang buram atau perlu dicek ulang oleh pengguna",
    },
  },
  required: ["supplier_name", "predicted_category", "items", "total_amount"],
};

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreMatch(itemName: string, ingredientName: string): number {
  const a = itemName.toLowerCase().trim();
  const b = ingredientName.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const tokensA = new Set(normalizeTokens(a));
  const tokensB = new Set(normalizeTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) overlap++;
  });

  return overlap / Math.max(tokensA.size, tokensB.size);
}

function suggestConversionFactor(receiptUnitRaw: string, stockUnit: IngredientUnit): number {
  const u = receiptUnitRaw.toLowerCase().trim();
  if ((u === "kg" || u === "kilogram") && stockUnit === "gram") return 1000;
  if ((u === "l" || u === "lt" || u === "liter" || u === "ltr") && stockUnit === "ml") return 1000;
  if ((u === "g" || u === "gr" || u === "gram") && stockUnit === "kg") return 0.001;
  if (u === "ml" && stockUnit === "liter") return 0.001;
  if ((u === "ons" || u === "hg") && stockUnit === "gram") return 100;
  return 1;
}

function normalizeReceiptDate(raw: string | undefined, fallbackDate: string): string {
  const val = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(val);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return fallbackDate;
}

function isRetryableModelError(err: unknown): { retryable: boolean; busy: boolean } {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const isBusy =
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|temporarily/i.test(msg);
  const isNotFound = status === 404 || /404|NOT_FOUND|no longer available/i.test(msg);
  return { retryable: isBusy || isNotFound, busy: isBusy };
}

export async function POST(request: Request) {
  try {
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
        { error: "Hanya owner yang dapat memindai struk pengeluaran" },
        { status: 403 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY belum terkonfigurasi di server" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";

    if (!imageBase64) {
      return NextResponse.json(
        { error: "Foto struk belum dikirim ke server" },
        { status: 400 }
      );
    }

    // Strip data URI prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    const ai = new GoogleGenAI({ apiKey });
    const prompt = [
      "Anda adalah asisten pembukuan UMKM kuliner Indonesia.",
      "Ekstrak seluruh informasi transaksi dari foto struk belanja ini ke dalam format JSON sesuai skema.",
      "Aturan penting:",
      "1. Semua angka harga dan total harus berupa angka Rupiah murni tanpa titik/koma pemisah ribuan (contoh: 15500, bukan 15.500).",
      "2. Jika satuan atau berat tercantum dalam nama barang seperti 'Minyak Goreng 2L' atau 'Gula 1kg', tetap tulis nama yang jelas dan ekstrak unit/kuantitas seakurat mungkin.",
      "3. Untuk predicted_category, pilih salah satu dari: Bahan Baku, Kemasan, Sewa, Gaji, Listrik, Operasional.",
      "4. Jika tanggal tidak terbaca jelas, kosongkan receipt_date.",
    ].join("\n");

    // Prioritaskan model Flash-Lite yang stabil dan cepat saat Flash penuh mengalami lonjakan trafik (503)
    const flashModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.7-flash",
      "gemini-3.8-flash",
    ];

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
    let lastModelError: unknown = null;
    let sawBusyError = false;

    for (const model of flashModels) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: cleanBase64 } },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: receiptSchema,
            temperature: 0.1,
          },
        });
        if (response?.text) break;
      } catch (err) {
        lastModelError = err;
        const { retryable, busy } = isRetryableModelError(err);
        if (busy) sawBusyError = true;
        if (retryable) {
          continue;
        }
        throw err;
      }
    }

    if (!response) {
      if (sawBusyError) {
        return NextResponse.json(
          {
            error:
              "Server AI Gemini sedang sangat padat sementara. Klik Coba Lagi beberapa detik lagi atau isi pengeluaran manual.",
          },
          { status: 503 }
        );
      }
      throw lastModelError instanceof Error
        ? lastModelError
        : new Error("Seluruh model Gemini sedang sibuk, coba lagi sebentar.");
    }

    const rawText = response.text;
    if (!rawText) {
      return NextResponse.json(
        { error: "AI tidak mengembalikan hasil pembacaan struk" },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(rawText) as {
      supplier_name?: string;
      receipt_date?: string;
      predicted_category?: string;
      items?: Array<{
        item_name: string;
        quantity: number;
        unit: string;
        unit_price: number;
        subtotal: number;
      }>;
      tax_amount?: number;
      discount_amount?: number;
      total_amount?: number;
      confidence_notes?: string;
    };

    // Match extracted items against UMKM's existing ingredients for automatic stock sync suggestion
    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, name, unit")
      .eq("user_id", profile.business_id);

    const ingList = (ingredients as Array<Pick<Ingredient, "id" | "name" | "unit">> | null) ?? [];

    const enrichedItems = (parsed.items ?? []).map((item) => {
      let bestMatch: Pick<Ingredient, "id" | "name" | "unit"> | null = null;
      let bestScore = 0;

      for (const ing of ingList) {
        const s = scoreMatch(item.item_name, ing.name);
        if (s > bestScore) {
          bestScore = s;
          bestMatch = ing;
        }
      }

      const matched = bestScore >= 0.45 ? bestMatch : null;
      return {
        item_name: item.item_name || "Item Struk",
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        unit: item.unit || "pcs",
        unit_price: Math.max(0, Number(item.unit_price) || 0),
        subtotal: Math.max(0, Number(item.subtotal) || 0),
        ingredient_id: matched?.id ?? null,
        matched_ingredient_name: matched?.name ?? null,
        stock_conversion_factor: matched
          ? suggestConversionFactor(item.unit || "pcs", matched.unit)
          : 1,
      };
    });

    const todayStr = toJakartaDateKey(new Date());
    const validDate = normalizeReceiptDate(parsed.receipt_date, todayStr);

    return NextResponse.json({
      receipt: {
        supplier_name: parsed.supplier_name || "",
        receipt_date: validDate,
        predicted_category: parsed.predicted_category || "Bahan Baku",
        items: enrichedItems,
        tax_amount: Math.max(0, Number(parsed.tax_amount) || 0),
        discount_amount: Math.max(0, Number(parsed.discount_amount) || 0),
        total_amount: Math.max(0, Number(parsed.total_amount) || 0),
        confidence_notes: parsed.confidence_notes || "",
      },
    });
  } catch (err) {
    console.error("OCR receipt error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Gagal memindai struk: ${err.message}`
            : "Terjadi kesalahan saat memproses gambar struk",
      },
      { status: 500 }
    );
  }
}

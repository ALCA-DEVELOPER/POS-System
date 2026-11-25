"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  Camera,
  CheckCircle,
  FloppyDisk,
  Images,
  Plus,
  Receipt,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { compressImageFile } from "@/lib/image-compress";
import { toJakartaDateKey } from "@/lib/analytics";
import { formatNumber, formatRupiah } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { ExpenseCategory, Ingredient, IngredientUnit } from "@/types/database";
import { ErrorState } from "@/components/ui/StatePanel";

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Bahan Baku",
  "Kemasan",
  "Sewa",
  "Gaji",
  "Listrik",
  "Operasional",
];

const STOCK_UNITS: IngredientUnit[] = ["gram", "ml", "pcs", "kg", "liter"];

interface VerificationItem {
  item_name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  subtotal: string;
  link_mode: "none" | "existing" | "new";
  ingredient_id: string;
  create_ingredient_name: string;
  create_ingredient_unit: IngredientUnit;
  stock_conversion_factor: string;
}

interface ScanReceiptClientProps {
  businessId: string;
  ingredients: Ingredient[];
}

export function ScanReceiptClient({ businessId, ingredients }: ScanReceiptClientProps) {
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [receiptStoragePath, setReceiptStoragePath] = useState<string | null>(null);
  const [scanStage, setScanStage] = useState<"idle" | "compressing" | "scanning" | "ready">(
    "idle"
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [confidenceNotes, setConfidenceNotes] = useState("");

  const today = toJakartaDateKey(new Date());
  const [supplierName, setSupplierName] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory>("Bahan Baku");
  const [paymentSource, setPaymentSource] = useState<"cash" | "bank" | "qris">("cash");
  const [description, setDescription] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [totalAmount, setTotalAmount] = useState("0");
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);
    setSavedOk(false);
    setScanStage("compressing");

    try {
      const { blob, base64, mimeType } = await compressImageFile(file);
      const localUrl = URL.createObjectURL(blob);
      setPreviewUrl(localUrl);

      setScanStage("scanning");

      // Upload receipt image to private Supabase Storage bucket
      const supabase = createClient();
      const storagePath = `${businessId}/struk-${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("receipts")
        .upload(storagePath, blob, { contentType: mimeType, upsert: false });

      if (!uploadErr) {
        setReceiptStoragePath(storagePath);
      }

      const res = await fetch("/api/ocr-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Gagal membaca struk belanja.");
      }

      const r = json.receipt;
      setSupplierName(r.supplier_name || "");
      setExpenseDate(r.receipt_date || today);
      setCategory(
        EXPENSE_CATEGORIES.includes(r.predicted_category)
          ? r.predicted_category
          : "Bahan Baku"
      );
      setTaxAmount(String(r.tax_amount ?? 0));
      setDiscountAmount(String(r.discount_amount ?? 0));
      setTotalAmount(String(r.total_amount ?? 0));
      setConfidenceNotes(r.confidence_notes ?? "");
      setDescription(
        r.supplier_name ? `Belanja dari ${r.supplier_name}` : "Belanja struk"
      );

      const mapped: VerificationItem[] = (r.items ?? []).map(
        (it: {
          item_name: string;
          quantity: number;
          unit: string;
          unit_price: number;
          subtotal: number;
          ingredient_id: string | null;
          stock_conversion_factor: number;
        }) => ({
          item_name: it.item_name,
          quantity: String(it.quantity),
          unit: it.unit || "pcs",
          unit_price: String(it.unit_price),
          subtotal: String(it.subtotal),
          link_mode: it.ingredient_id ? "existing" : "none",
          ingredient_id: it.ingredient_id ?? (ingredients[0]?.id ?? ""),
          create_ingredient_name: it.item_name,
          create_ingredient_unit: "pcs",
          stock_conversion_factor: String(it.stock_conversion_factor ?? 1),
        })
      );

      setItems(mapped);
      setScanStage("ready");
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Gagal memproses foto struk."
      );
      setScanStage("ready");
    } finally {
      e.target.value = "";
    }
  };

  const startManualEntry = () => {
    setScanError(null);
    setSavedOk(false);
    setPreviewUrl(null);
    setReceiptStoragePath(null);
    setConfidenceNotes("");
    setItems([
      {
        item_name: "",
        quantity: "1",
        unit: "pcs",
        unit_price: "0",
        subtotal: "0",
        link_mode: "none",
        ingredient_id: ingredients[0]?.id ?? "",
        create_ingredient_name: "",
        create_ingredient_unit: "pcs",
        stock_conversion_factor: "1",
      },
    ]);
    setScanStage("ready");
  };

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      {
        item_name: "",
        quantity: "1",
        unit: "pcs",
        unit_price: "0",
        subtotal: "0",
        link_mode: "none",
        ingredient_id: ingredients[0]?.id ?? "",
        create_ingredient_name: "",
        create_ingredient_unit: "pcs",
        stock_conversion_factor: "1",
      },
    ]);
  };

  const updateItem = (idx: number, patch: Partial<VerificationItem>) => {
    setItems((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if ("quantity" in patch || "unit_price" in patch) {
          const q = Number(next.quantity) || 0;
          const p = Number(next.unit_price) || 0;
          next.subtotal = String(Math.round(q * p));
        }
        return next;
      })
    );
  };

  const recalculateTotalFromItems = () => {
    const itemsSum = items.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
    const tax = Number(taxAmount) || 0;
    const disc = Number(discountAmount) || 0;
    setTotalAmount(String(Math.max(0, itemsSum + tax - disc)));
  };

  const handleSaveExpense = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setScanError(null);

    try {
      const supabase = createClient();
      const payloadItems = items
        .filter((r) => r.item_name.trim() !== "")
        .map((r) => ({
          item_name: r.item_name.trim(),
          quantity: Math.max(0.001, Number(r.quantity) || 1),
          unit: r.unit.trim() || "pcs",
          unit_price: Math.max(0, Number(r.unit_price) || 0),
          subtotal: Math.max(0, Number(r.subtotal) || 0),
          ingredient_id: r.link_mode === "existing" ? r.ingredient_id : null,
          create_ingredient_name:
            r.link_mode === "new" ? r.create_ingredient_name.trim() || r.item_name.trim() : null,
          create_ingredient_unit: r.link_mode === "new" ? r.create_ingredient_unit : null,
          stock_conversion_factor: Math.max(
            0.0001,
            Number(r.stock_conversion_factor) || 1
          ),
        }));

      const { error } = await supabase.rpc("save_verified_expense", {
        p_supplier_name: supplierName.trim(),
        p_category: category,
        p_description: description.trim() || `Belanja ${supplierName || category}`,
        p_expense_date: expenseDate,
        p_tax_amount: Math.max(0, Number(taxAmount) || 0),
        p_discount_amount: Math.max(0, Number(discountAmount) || 0),
        p_total_amount: Math.max(0, Number(totalAmount) || 0),
        p_payment_source: paymentSource,
        p_receipt_image_url: receiptStoragePath,
        p_items: payloadItems,
      });

      if (error) throw new Error(error.message);

      void broadcastBusinessUpdate(businessId, "expenses");
      setSavedOk(true);
      router.push("/pengeluaran");
      router.refresh();
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Gagal menyimpan pengeluaran ke database."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      {scanError ? (
        <ErrorState
          title="Kendala pemindaian struk"
          message={scanError}
          onRetry={() => setScanError(null)}
        />
      ) : null}

      {savedOk ? (
        <div
          role="status"
          className="rounded-2xl border border-[#14532D]/30 bg-emerald-50/90 px-4 py-3 text-sm text-[#1C1917] flex items-center gap-2.5"
        >
          <CheckCircle size={20} weight="bold" className="text-[#14532D]" aria-hidden="true" />
          <span>Pengeluaran tersimpan dan stok bahan baku berhasil diperbarui.</span>
        </div>
      ) : null}

      {/* Capture Actions */}
      <section className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              Ambil Foto Struk Belanja
            </h2>
            <p className="text-xs sm:text-sm text-[#44403C]">
              Foto nota pasar, minimarket, atau supplier. Sistem membaca item, harga, dan
              menyarankan pencocokan stok bahan baku untuk Anda verifikasi.
            </p>
          </div>
          <Link
            href="/pengeluaran"
            className="text-xs sm:text-sm font-semibold text-[#14532D] hover:underline shrink-0"
          >
            Lihat Riwayat Pengeluaran
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label
            htmlFor="camera-capture"
            className="min-h-14 rounded-2xl bg-[#B43D0A] text-white px-4 py-3 flex items-center justify-center gap-2.5 text-sm font-bold hover:bg-[#9A3412] transition-colors shadow-sm"
          >
            <Camera size={22} weight="bold" aria-hidden="true" />
            Foto Struk Pakai Kamera
          </label>
          <input
            id="camera-capture"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleFileChange}
          />

          <label
            htmlFor="gallery-upload"
            className="min-h-14 rounded-2xl bg-[#14532D] text-white px-4 py-3 flex items-center justify-center gap-2.5 text-sm font-bold hover:bg-[#166534] transition-colors"
          >
            <Images size={22} weight="bold" aria-hidden="true" />
            Pilih Foto dari Galeri
          </label>
          <input
            id="gallery-upload"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
          />

          <button
            type="button"
            onClick={startManualEntry}
            className="min-h-14 rounded-2xl border border-[#1C1917]/20 bg-white/85 text-[#1C1917] px-4 py-3 flex items-center justify-center gap-2 text-sm font-bold hover:bg-white transition-colors"
          >
            <Receipt size={20} weight="duotone" aria-hidden="true" />
            Input Pengeluaran Manual
          </button>
        </div>

        {scanStage === "compressing" || scanStage === "scanning" ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl bg-[#14532D]/10 border border-[#14532D]/20 p-4 flex items-center gap-3"
          >
            <div className="w-5 h-5 rounded-full border-2 border-[#14532D] border-t-transparent animate-spin shrink-0" />
            <p className="text-sm font-semibold text-[#1C1917]">
              {scanStage === "compressing"
                ? "Mengompres foto struk agar cepat diunggah..."
                : "Membaca daftar belanja dan harga dari foto struk..."}
            </p>
          </div>
        ) : null}
      </section>

      {/* Verification Form */}
      {scanStage === "ready" ? (
        <form onSubmit={handleSaveExpense} className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {previewUrl ? (
            <div className="lg:col-span-4 glass-panel rounded-2xl p-4 space-y-2 self-start">
              <p className="text-xs font-bold text-[#44403C]">Pratinjau Foto Struk</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Pratinjau struk belanja"
                width={400}
                height={600}
                className="w-full max-h-[420px] object-contain rounded-xl bg-white border border-[#1C1917]/10"
              />
            </div>
          ) : null}

          <div
            className={`${
              previewUrl ? "lg:col-span-8" : "lg:col-span-12"
            } glass-elevated rounded-2xl p-5 space-y-5`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#1C1917]">
                  Verifikasi Data Pengeluaran
                </h3>
                <p className="text-xs text-[#44403C]">
                  Periksa angka dan cocokan item bahan baku sebelum menekan Simpan.
                </p>
              </div>
              <button
                type="button"
                onClick={recalculateTotalFromItems}
                className="min-h-9 shrink-0 rounded-lg border border-[#14532D]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#14532D] hover:bg-[#14532D]/5"
              >
                Hitung Ulang Total
              </button>
            </div>

            {confidenceNotes ? (
              <div className="rounded-xl bg-[#FEF3C7] text-[#92400E] px-3.5 py-2.5 text-xs font-medium flex items-start gap-2">
                <Warning size={16} weight="bold" className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>Catatan pembacaan struk: {confidenceNotes}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <label htmlFor="supplier" className="block text-xs font-semibold text-[#1C1917]">
                  Nama Toko / Supplier
                </label>
                <input
                  id="supplier"
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Contoh: Pasar Induk / Toko Bahan Kue"
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm text-[#1C1917]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="expDate" className="block text-xs font-semibold text-[#1C1917]">
                  Tanggal Belanja
                </label>
                <input
                  id="expDate"
                  type="date"
                  required
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm text-[#1C1917]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="expCat" className="block text-xs font-semibold text-[#1C1917]">
                  Kategori Pengeluaran
                </label>
                <select
                  id="expCat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm text-[#1C1917]"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="paySrc" className="block text-xs font-semibold text-[#1C1917]">
                  Sumber Dana Pembayaran
                </label>
                <select
                  id="paySrc"
                  value={paymentSource}
                  onChange={(e) =>
                    setPaymentSource(e.target.value as "cash" | "bank" | "qris")
                  }
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm text-[#1C1917]"
                >
                  <option value="cash">Kas Tunai</option>
                  <option value="bank">Rekening Bank</option>
                  <option value="qris">QRIS / E-Wallet</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="expDesc" className="block text-xs font-semibold text-[#1C1917]">
                Keterangan Singkat
              </label>
              <input
                id="expDesc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Catatan belanja atau operasional"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm text-[#1C1917]"
              />
            </div>

            {/* Scanned Item Rows + Stock Sync Mapping */}
            <div className="space-y-3 pt-2 border-t border-[#1C1917]/10">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#1C1917]">
                  Rincian Barang & Sinkron Stok ({items.length})
                </h4>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="min-h-9 inline-flex items-center gap-1 rounded-lg border border-[#14532D] px-2.5 py-1 text-xs font-bold text-[#14532D]"
                >
                  <Plus size={14} weight="bold" aria-hidden="true" />
                  Tambah Item
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-[#44403C] bg-black/5 rounded-xl p-3">
                  Belum ada rincian item. Tambahkan item jika ingin menyinkronkan ke stok bahan baku.
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const matchedIng =
                      item.link_mode === "existing"
                        ? ingredientMap.get(item.ingredient_id)
                        : null;
                    const stockUnit =
                      item.link_mode === "existing"
                        ? matchedIng?.unit
                        : item.link_mode === "new"
                          ? item.create_ingredient_unit
                          : null;
                    const addedStock =
                      (Number(item.quantity) || 0) *
                      (Number(item.stock_conversion_factor) || 1);

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-[#1C1917]/12 bg-white/85 p-3 space-y-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            aria-label={`Nama item baris ${idx + 1}`}
                            value={item.item_name}
                            onChange={(e) =>
                              updateItem(idx, {
                                item_name: e.target.value,
                                create_ingredient_name: e.target.value,
                              })
                            }
                            placeholder="Nama barang di struk"
                            className="min-h-10 flex-1 rounded-lg border border-[#1C1917]/20 bg-white px-3 text-sm font-medium text-[#1C1917]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label={`Hapus item baris ${idx + 1}`}
                            className="w-10 h-10 rounded-lg inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                          >
                            <Trash size={16} weight="bold" aria-hidden="true" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <label className="block text-[11px] text-[#44403C]">Qty</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(idx, { quantity: e.target.value })
                              }
                              className="min-h-10 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-sm tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#44403C]">Satuan Struk</label>
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => updateItem(idx, { unit: e.target.value })}
                              className="min-h-10 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#44403C]">Harga Satuan</label>
                            <input
                              type="number"
                              min="0"
                              value={item.unit_price}
                              onChange={(e) =>
                                updateItem(idx, { unit_price: e.target.value })
                              }
                              className="min-h-10 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-sm tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#44403C]">Subtotal</label>
                            <input
                              type="number"
                              min="0"
                              value={item.subtotal}
                              onChange={(e) =>
                                updateItem(idx, { subtotal: e.target.value })
                              }
                              className="min-h-10 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-sm font-bold tabular-nums"
                            />
                          </div>
                        </div>

                        {/* Stock Sync Mapping */}
                        <div className="rounded-lg bg-[#14532D]/6 p-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                          <div className="sm:col-span-5 space-y-1">
                            <label className="block text-[11px] font-semibold text-[#14532D]">
                              Sinkronkan ke Stok Bahan
                            </label>
                            <select
                              value={
                                item.link_mode === "none"
                                  ? "__none__"
                                  : item.link_mode === "new"
                                    ? "__new__"
                                    : item.ingredient_id
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "__none__") {
                                  updateItem(idx, { link_mode: "none" });
                                } else if (val === "__new__") {
                                  updateItem(idx, {
                                    link_mode: "new",
                                    create_ingredient_name: item.item_name,
                                    stock_conversion_factor: "1",
                                  });
                                } else {
                                  updateItem(idx, {
                                    link_mode: "existing",
                                    ingredient_id: val,
                                  });
                                }
                              }}
                              className="min-h-9 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-xs text-[#1C1917]"
                            >
                              <option value="__none__">Tidak perlu tambah stok</option>
                              <option value="__new__">+ Buat bahan baku baru</option>
                              {ingredients.map((ing) => (
                                <option key={ing.id} value={ing.id}>
                                  Tambah ke: {ing.name} ({ing.unit})
                                </option>
                              ))}
                            </select>
                          </div>

                          {item.link_mode === "new" ? (
                            <div className="sm:col-span-4 space-y-1">
                              <label className="block text-[11px] text-[#44403C]">
                                Satuan Bahan Baru
                              </label>
                              <select
                                value={item.create_ingredient_unit}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    create_ingredient_unit: e.target.value as IngredientUnit,
                                  })
                                }
                                className="min-h-9 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-xs text-[#1C1917]"
                              >
                                {STOCK_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          {item.link_mode !== "none" ? (
                            <div
                              className={`${
                                item.link_mode === "new" ? "sm:col-span-3" : "sm:col-span-7"
                              } space-y-1`}
                            >
                              <label className="block text-[11px] text-[#44403C]">
                                Faktor Konversi (1 {item.unit} = ? {stockUnit})
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0.001"
                                  value={item.stock_conversion_factor}
                                  onChange={(e) =>
                                    updateItem(idx, {
                                      stock_conversion_factor: e.target.value,
                                    })
                                  }
                                  className="min-h-9 w-24 rounded-lg border border-[#1C1917]/20 bg-white px-2 text-xs tabular-nums"
                                />
                                <span className="text-[11px] font-bold text-[#14532D] tabular-nums">
                                  +{formatNumber(addedStock)} {stockUnit}
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tax, Discount, Total */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#1C1917]/10">
              <div className="space-y-1">
                <label htmlFor="taxAmt" className="block text-xs font-semibold text-[#1C1917]">
                  PPN / Pajak (Rp)
                </label>
                <input
                  id="taxAmt"
                  type="number"
                  min="0"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="discAmt" className="block text-xs font-semibold text-[#1C1917]">
                  Diskon Struk (Rp)
                </label>
                <input
                  id="discAmt"
                  type="number"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-sm tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="totalAmt" className="block text-xs font-bold text-[#14532D]">
                  Total Bayar Final (Rp)
                </label>
                <input
                  id="totalAmt"
                  type="number"
                  min="0"
                  required
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="min-h-11 w-full rounded-xl border-2 border-[#14532D] bg-white px-3 py-2 text-base font-extrabold text-[#14532D] tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <p className="text-xs text-[#44403C] tabular-nums">
                Total tercatat:{" "}
                <span className="font-bold text-[#1C1917]">
                  {formatRupiah(totalAmount)}
                </span>
              </p>
              <button
                type="submit"
                disabled={saving}
                className="min-h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-6 py-3 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
              >
                <FloppyDisk size={18} weight="bold" aria-hidden="true" />
                {saving ? "Menyimpan & menyinkronkan stok..." : "Simpan Pengeluaran & Sinkron Stok"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}

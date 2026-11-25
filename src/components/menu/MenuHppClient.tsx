"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, formatRupiah } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { Ingredient, ProductCategory, ProductWithHpp } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";

const CATEGORIES: ProductCategory[] = ["Makanan", "Minuman", "Paket", "Topping"];

interface RecipeDraftRow {
  ingredient_id: string;
  quantity_needed: string;
}

interface MenuHppClientProps {
  businessId: string;
  initialProducts: ProductWithHpp[];
  ingredients: Ingredient[];
}

export function MenuHppClient({
  businessId,
  initialProducts,
  ingredients,
}: MenuHppClientProps) {
  const [products, setProducts] = useState<ProductWithHpp[]>(initialProducts);
  const [categoryFilter, setCategoryFilter] = useState<"Semua" | ProductCategory>("Semua");

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);
  const [search, setSearch] = useState("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithHpp | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("Makanan");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [recipeRows, setRecipeRows] = useState<RecipeDraftRow[]>([]);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [saving, setSaving] = useState(false);

  const ingredientMap = useMemo(() => {
    return new Map(ingredients.map((i) => [i.id, i]));
  }, [ingredients]);

  const reloadProducts = async () => {
    setErrorBanner(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*, recipes(*, ingredient:ingredients(*))")
      .eq("user_id", businessId)
      .order("name", { ascending: true });

    if (error) {
      setErrorBanner(error.message);
      return;
    }

    const hydrated: ProductWithHpp[] = (data ?? []).map((p) => {
      const recipes = (p.recipes ?? []) as ProductWithHpp["recipes"];
      const hpp = recipes.reduce((sum, r) => {
        const unitCost = Number(r.ingredient?.cost_per_unit ?? 0);
        return sum + Number(r.quantity_needed) * unitCost;
      }, 0);
      const sellPrice = Number(p.price);
      const marginAmt = sellPrice - hpp;
      const marginPct = sellPrice > 0 ? (marginAmt / sellPrice) * 100 : 0;
      return {
        ...p,
        recipes,
        hpp,
        gross_margin_amount: marginAmt,
        gross_margin_percent: marginPct,
      };
    });

    setProducts(hydrated);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "Semua" && p.category !== categoryFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, categoryFilter, search]);

  const liveHpp = useMemo(() => {
    return recipeRows.reduce((sum, row) => {
      const ing = ingredientMap.get(row.ingredient_id);
      const qty = Number(row.quantity_needed) || 0;
      if (!ing || qty <= 0) return sum;
      return sum + qty * Number(ing.cost_per_unit);
    }, 0);
  }, [recipeRows, ingredientMap]);

  const sellNum = Number(price) || 0;
  const liveMarginAmount = sellNum - liveHpp;
  const liveMarginPercent = sellNum > 0 ? (liveMarginAmount / sellNum) * 100 : 0;

  const openCreateModal = () => {
    setEditingProduct(null);
    setName("");
    setCategory("Makanan");
    setPrice("");
    setImageUrl(null);
    setIsActive(true);
    setRecipeRows([]);
    setModalOpen(true);
  };

  const openEditModal = (product: ProductWithHpp) => {
    setEditingProduct(product);
    setName(product.name);
    setCategory(product.category);
    setPrice(String(product.price));
    setImageUrl(product.image_url);
    setIsActive(product.is_active);
    setRecipeRows(
      product.recipes.map((r) => ({
        ingredient_id: r.ingredient_id,
        quantity_needed: String(r.quantity_needed),
      }))
    );
    setModalOpen(true);
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    setErrorBanner(null);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${businessId}/menu-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("menu-images")
        .upload(path, file, { upsert: true });

      if (error) throw new Error(error.message);
      const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Gagal unggah foto menu.");
    } finally {
      setUploadingImg(false);
      e.target.value = "";
    }
  };

  const addRecipeRow = () => {
    const unused = ingredients.find(
      (ing) => !recipeRows.some((r) => r.ingredient_id === ing.id)
    );
    const fallback = unused ?? ingredients[0];
    if (!fallback) return;
    setRecipeRows((prev) => [
      ...prev,
      { ingredient_id: fallback.id, quantity_needed: "1" },
    ]);
  };

  const handleSaveMenu = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorBanner(null);

    try {
      const supabase = createClient();
      let productId = editingProduct?.id;

      const productPayload = {
        user_id: businessId,
        name: name.trim(),
        category,
        price: Math.max(0, Number(price) || 0),
        image_url: imageUrl,
        is_active: isActive,
      };

      if (productId) {
        const { error } = await supabase
          .from("products")
          .update(productPayload)
          .eq("id", productId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(productPayload)
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "Gagal membuat menu");
        productId = data.id;
      }

      // Deduplicate valid recipe lines and sync
      const validRecipes = new Map<string, number>();
      for (const row of recipeRows) {
        const qty = Number(row.quantity_needed);
        if (row.ingredient_id && qty > 0) {
          validRecipes.set(
            row.ingredient_id,
            (validRecipes.get(row.ingredient_id) ?? 0) + qty
          );
        }
      }

      await supabase.from("recipes").delete().eq("product_id", productId);

      if (validRecipes.size > 0) {
        const inserts = Array.from(validRecipes.entries()).map(
          ([ingredient_id, quantity_needed]) => ({
            product_id: productId!,
            ingredient_id,
            quantity_needed,
          })
        );
        const { error: recErr } = await supabase.from("recipes").insert(inserts);
        if (recErr) throw new Error(recErr.message);
      }

      setModalOpen(false);
      await reloadProducts();
      void broadcastBusinessUpdate(businessId, "menu");
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Gagal menyimpan menu & resep.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (product: ProductWithHpp) => {
    const supabase = createClient();
    await supabase
      .from("products")
      .update({ is_active: !product.is_active })
      .eq("id", product.id);
    await reloadProducts();
    void broadcastBusinessUpdate(businessId, "menu");
  };

  const handleDeleteProduct = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      setErrorBanner(
        "Menu sudah pernah tercatat di transaksi penjualan. Nonaktifkan menu jika tidak dijual lagi."
      );
      return;
    }
    await reloadProducts();
    void broadcastBusinessUpdate(businessId, "menu");
  };

  return (
    <div className="space-y-4">
      {errorBanner ? (
        <ErrorState
          title="Kendala pada data menu"
          message={errorBanner}
          onRetry={reloadProducts}
        />
      ) : null}

      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {(["Semua", ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`min-h-10 shrink-0 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                categoryFilter === cat
                  ? "bg-[#14532D] text-white"
                  : "bg-white/75 text-[#1C1917] hover:bg-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-60">
            <MagnifyingGlass
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#44403C]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Cari menu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama menu..."
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 pl-9 pr-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
            Tambah Menu
          </button>
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <EmptyState
          title={
            products.length === 0
              ? "Belum ada menu makanan atau minuman"
              : "Tidak ada menu di kategori ini"
          }
          description={
            products.length === 0
              ? "Buat menu jual lalu hubungkan takaran bahan bakunya agar HPP dan margin keuntungan langsung terhitung otomatis."
              : "Ubah filter kategori atau kata kunci pencarian."
          }
          action={
            products.length === 0 ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-bold text-white"
              >
                <Plus size={18} weight="bold" aria-hidden="true" />
                Buat Menu Pertama
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProducts.map((product) => {
            const isLoss = product.gross_margin_amount < 0;
            const isThin = !isLoss && product.gross_margin_percent < 30;
            return (
              <article
                key={product.id}
                className="glass-panel rounded-2xl p-4 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-16 h-16 rounded-xl bg-white/80 border border-[#1C1917]/10 overflow-hidden shrink-0 flex items-center justify-center">
                    {product.image_url ? (
                      <Image
                        src={product.image_url}
                        alt={product.name}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-extrabold text-[#14532D]">
                        {product.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-[#44403C]">
                        {product.category}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(product)}
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                          product.is_active
                            ? "bg-emerald-100 text-[#14532D]"
                            : "bg-stone-200 text-[#44403C]"
                        }`}
                      >
                        {product.is_active ? "Aktif" : "Nonaktif"}
                      </button>
                    </div>
                    <h2 className="text-base font-bold text-[#1C1917] truncate">
                      {product.name}
                    </h2>
                    <p className="text-lg font-extrabold text-[#14532D] tabular-nums">
                      {formatRupiah(product.price)}
                    </p>
                  </div>
                </div>

                {/* HPP & Margin Summary */}
                <div className="rounded-xl bg-white/70 border border-[#1C1917]/10 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#44403C]">
                      HPP Resep ({product.recipes.length} bahan)
                    </span>
                    <span className="font-bold text-[#1C1917] tabular-nums">
                      {formatRupiah(product.hpp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#44403C]">Laba Kotor / Porsi</span>
                    <span
                      className={`font-bold tabular-nums ${
                        isLoss ? "text-[#B91C1C]" : "text-[#14532D]"
                      }`}
                    >
                      {formatRupiah(product.gross_margin_amount)} (
                      {product.gross_margin_percent.toFixed(1)}%)
                    </span>
                  </div>
                  {product.recipes.length === 0 ? (
                    <p className="text-[11px] font-medium text-[#92400E] pt-0.5">
                      Belum ada resep bahan baku. Tambahkan resep agar stok terpotong otomatis.
                    </p>
                  ) : isLoss || isThin ? (
                    <p className="inline-flex items-center gap-1 text-[11px] font-bold text-[#B43D0A] pt-0.5">
                      <Warning size={13} weight="bold" aria-hidden="true" />
                      {isLoss
                        ? "Harga jual lebih rendah dari HPP"
                        : "Margin di bawah 30%, tinjau harga jual"}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(product)}
                    className="min-h-10 flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/85 px-3 py-2 text-xs font-bold text-[#1C1917] hover:bg-white"
                  >
                    <PencilSimple size={15} weight="bold" aria-hidden="true" />
                    Edit Menu & Resep
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProduct(product.id)}
                    aria-label={`Hapus menu ${product.name}`}
                    className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white/85 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                  >
                    <Trash size={16} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal Tambah / Edit Menu + Resep HPP */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingProduct ? "Edit Menu & Resep HPP" : "Tambah Menu & Resep HPP"}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveMenu} className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-[#1C1917]/15 bg-white overflow-hidden shrink-0 flex items-center justify-center">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt="Preview foto menu"
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs font-bold text-[#44403C]">Foto</span>
              )}
            </div>
            <div className="space-y-1">
              <label
                htmlFor="menu-img-upload"
                className="min-h-10 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-xs font-semibold text-[#1C1917]"
              >
                <UploadSimple size={15} weight="bold" aria-hidden="true" />
                {uploadingImg ? "Mengunggah..." : "Unggah Foto Menu"}
              </label>
              <input
                id="menu-img-upload"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleImageUpload}
              />
              <p className="text-[11px] text-[#44403C]">Opsional. Muncul di layar POS Kasir.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <label htmlFor="menuName" className="block text-sm font-semibold text-[#1C1917]">
                Nama Menu
              </label>
              <input
                id="menuName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Nasi Ayam Bakar Madu"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="menuCategory" className="block text-sm font-semibold text-[#1C1917]">
                Kategori
              </label>
              <select
                id="menuCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductCategory)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <label htmlFor="menuPrice" className="block text-sm font-semibold text-[#1C1917]">
                Harga Jual (Rp)
              </label>
              <input
                id="menuPrice"
                type="number"
                min="0"
                step="100"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="25000"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
              />
            </div>

            <label className="min-h-11 inline-flex items-center gap-2.5 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2 text-sm font-semibold text-[#1C1917]">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 accent-[#14532D]"
              />
              Tampilkan di Kasir POS
            </label>
          </div>

          {/* Recipe Builder (BOM) */}
          <div className="space-y-3 pt-2 border-t border-[#1C1917]/10">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#1C1917]">
                  Komposisi Resep & Kalkulasi HPP
                </h3>
                <p className="text-xs text-[#44403C]">
                  Takaran per 1 porsi untuk hitung modal otomatis & potong stok saat laku.
                </p>
              </div>
              {ingredients.length > 0 ? (
                <button
                  type="button"
                  onClick={addRecipeRow}
                  className="min-h-10 shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-[#14532D] px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-[#14532D]/10"
                >
                  <Plus size={14} weight="bold" aria-hidden="true" />
                  Tambah Bahan
                </button>
              ) : null}
            </div>

            {ingredients.length === 0 ? (
              <div className="rounded-xl bg-[#FEF3C7] p-3 text-xs text-[#92400E] flex items-center justify-between gap-3">
                <span>Anda belum memiliki data bahan baku.</span>
                <Link href="/stok" className="font-bold underline shrink-0">
                  Isi Bahan Baku
                </Link>
              </div>
            ) : recipeRows.length === 0 ? (
              <p className="text-xs text-[#44403C] bg-black/5 rounded-xl p-3">
                Belum ada bahan dipilih untuk menu ini. Klik &quot;Tambah Bahan&quot; untuk menghitung HPP.
              </p>
            ) : (
              <div className="space-y-2">
                {recipeRows.map((row, idx) => {
                  const selectedIng = ingredientMap.get(row.ingredient_id);
                  const lineCost =
                    (Number(row.quantity_needed) || 0) *
                    Number(selectedIng?.cost_per_unit ?? 0);

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center rounded-xl border border-[#1C1917]/10 bg-white/80 p-2.5"
                    >
                      <select
                        aria-label={`Bahan resep baris ${idx + 1}`}
                        value={row.ingredient_id}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRecipeRows((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, ingredient_id: val } : item
                            )
                          );
                        }}
                        className="col-span-12 sm:col-span-5 min-h-10 rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-xs sm:text-sm text-[#1C1917]"
                      >
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} ({ing.unit})
                          </option>
                        ))}
                      </select>

                      <div className="col-span-6 sm:col-span-3 flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          aria-label={`Takaran bahan baris ${idx + 1}`}
                          value={row.quantity_needed}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRecipeRows((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, quantity_needed: val } : item
                              )
                            );
                          }}
                          className="min-h-10 w-full rounded-lg border border-[#1C1917]/20 bg-white px-2.5 text-xs sm:text-sm text-[#1C1917] tabular-nums"
                        />
                        <span className="text-xs text-[#44403C] shrink-0">
                          {selectedIng?.unit ?? ""}
                        </span>
                      </div>

                      <div className="col-span-4 sm:col-span-3 text-right text-xs font-bold text-[#1C1917] tabular-nums">
                        {formatRupiah(lineCost)}
                      </div>

                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setRecipeRows((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={`Hapus bahan baris ${idx + 1}`}
                          className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                        >
                          <Trash size={15} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live HPP Result */}
            <div className="rounded-xl bg-[#14532D]/10 border border-[#14532D]/20 p-3.5 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[11px] font-semibold text-[#44403C]">Estimasi HPP</p>
                <p className="text-sm sm:text-base font-extrabold text-[#1C1917] tabular-nums">
                  {formatRupiah(liveHpp)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#44403C]">Laba Kotor</p>
                <p
                  className={`text-sm sm:text-base font-extrabold tabular-nums ${
                    liveMarginAmount < 0 ? "text-[#B91C1C]" : "text-[#14532D]"
                  }`}
                >
                  {formatRupiah(liveMarginAmount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#44403C]">Margin Profit</p>
                <p
                  className={`text-sm sm:text-base font-extrabold tabular-nums ${
                    liveMarginPercent < 0 ? "text-[#B91C1C]" : "text-[#14532D]"
                  }`}
                >
                  {formatNumber(liveMarginPercent)}%
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 py-2 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 py-2 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60"
            >
              {saving ? "Menyimpan..." : "Simpan Menu & Resep"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

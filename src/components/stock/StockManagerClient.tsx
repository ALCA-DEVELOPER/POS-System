"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowsLeftRight,
  ClockCounterClockwise,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { diffDaysFromTodayWib } from "@/lib/analytics";
import { formatDateId, formatNumber, formatRupiah } from "@/lib/format";
import type {
  Ingredient,
  IngredientUnit,
  KitchenIngredient,
  MovementType,
  StockMovement,
  UserRole,
} from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";

const UNITS: IngredientUnit[] = ["gram", "ml", "pcs", "kg", "liter"];

const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase: "Belanja Masuk",
  sale_deduct: "Terpakai POS",
  waste: "Bahan Sisa / Waste",
  adjustment: "Stock Opname",
};

interface StockManagerClientProps {
  role: UserRole;
  businessId: string;
  initialIngredients: Array<Ingredient | KitchenIngredient>;
  initialMovements: StockMovement[];
}

function getExpiryDiffDays(expiryDate: string | null): number | null {
  return diffDaysFromTodayWib(expiryDate);
}

export function StockManagerClient({
  role,
  businessId,
  initialIngredients,
  initialMovements,
}: StockManagerClientProps) {
  const isOwner = role === "owner";

  const [ingredients, setIngredients] =
    useState<Array<Ingredient | KitchenIngredient>>(initialIngredients);
  const [movements, setMovements] = useState<StockMovement[]>(initialMovements);
  const [activeTab, setActiveTab] = useState<"stock" | "movements">("stock");
  const [search, setSearch] = useState("");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Add/Edit Ingredient Modal (Owner only)
  const [ingModalOpen, setIngModalOpen] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [ingName, setIngName] = useState("");
  const [ingUnit, setIngUnit] = useState<IngredientUnit>("gram");
  const [ingStock, setIngStock] = useState("0");
  const [ingMinStock, setIngMinStock] = useState("0");
  const [ingCost, setIngCost] = useState("0");
  const [ingExpiry, setIngExpiry] = useState("");
  const [savingIng, setSavingIng] = useState(false);

  // Stock Opname Modal (Owner only)
  const [opnameTarget, setOpnameTarget] = useState<Ingredient | KitchenIngredient | null>(
    null
  );
  const [opnameNewStock, setOpnameNewStock] = useState("");
  const [opnameNotes, setOpnameNotes] = useState("");
  const [savingOpname, setSavingOpname] = useState(false);

  // Waste Modal (Owner & Kitchen)
  const [wasteTarget, setWasteTarget] = useState<Ingredient | KitchenIngredient | null>(
    null
  );
  const [wasteQty, setWasteQty] = useState("");
  const [wasteReason, setWasteReason] = useState("Kedaluwarsa / basi");
  const [savingWaste, setSavingWaste] = useState(false);

  const reloadData = async () => {
    setErrorBanner(null);
    const supabase = createClient();

    if (isOwner) {
      const [{ data: ingData, error: ingErr }, { data: movData }] = await Promise.all([
        supabase
          .from("ingredients")
          .select("*")
          .eq("user_id", businessId)
          .order("name", { ascending: true }),
        supabase
          .from("stock_movements")
          .select("*, ingredient:ingredients(name, unit)")
          .eq("user_id", businessId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (ingErr) {
        setErrorBanner(ingErr.message);
        return;
      }
      setIngredients((ingData as Ingredient[] | null) ?? []);
      setMovements((movData as StockMovement[] | null) ?? []);
    } else {
      const [{ data: ingData, error: ingErr }, { data: movData }] = await Promise.all([
        supabase.rpc("get_kitchen_ingredients"),
        supabase
          .from("stock_movements")
          .select("*, ingredient:ingredients(name, unit)")
          .eq("user_id", businessId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (ingErr) {
        setErrorBanner(ingErr.message);
        return;
      }
      setIngredients((ingData as KitchenIngredient[] | null) ?? []);
      setMovements((movData as StockMovement[] | null) ?? []);
    }
  };

  const criticalCount = useMemo(() => {
    return ingredients.filter((item) => {
      const low = Number(item.current_stock) <= Number(item.minimum_stock);
      const expDays = getExpiryDiffDays(item.nearest_expiry_date);
      return low || (expDays !== null && expDays <= 7);
    }).length;
  }, [ingredients]);

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter((item) => {
      const matchSearch = !q || item.name.toLowerCase().includes(q);
      if (!matchSearch) return false;
      if (!onlyCritical) return true;
      const low = Number(item.current_stock) <= Number(item.minimum_stock);
      const expDays = getExpiryDiffDays(item.nearest_expiry_date);
      return low || (expDays !== null && expDays <= 7);
    });
  }, [ingredients, search, onlyCritical]);

  const openCreateModal = () => {
    setEditingIng(null);
    setIngName("");
    setIngUnit("gram");
    setIngStock("0");
    setIngMinStock("100");
    setIngCost("0");
    setIngExpiry("");
    setIngModalOpen(true);
  };

  const openEditModal = (item: Ingredient) => {
    setEditingIng(item);
    setIngName(item.name);
    setIngUnit(item.unit);
    setIngStock(String(item.current_stock));
    setIngMinStock(String(item.minimum_stock));
    setIngCost(String(item.cost_per_unit));
    setIngExpiry(item.nearest_expiry_date ?? "");
    setIngModalOpen(true);
  };

  const handleSaveIngredient = async (e: FormEvent) => {
    e.preventDefault();
    setSavingIng(true);
    setErrorBanner(null);

    try {
      const supabase = createClient();
      const payload = {
        user_id: businessId,
        name: ingName.trim(),
        unit: ingUnit,
        current_stock: Number(ingStock) || 0,
        minimum_stock: Math.max(0, Number(ingMinStock) || 0),
        cost_per_unit: Math.max(0, Number(ingCost) || 0),
        nearest_expiry_date: ingExpiry || null,
      };

      if (editingIng) {
        const { error } = await supabase
          .from("ingredients")
          .update(payload)
          .eq("id", editingIng.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("ingredients").insert(payload);
        if (error) throw new Error(error.message);
      }

      setIngModalOpen(false);
      await reloadData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Gagal menyimpan bahan baku.");
    } finally {
      setSavingIng(false);
    }
  };

  const handleDeleteIngredient = async (id: string) => {
    setErrorBanner(null);
    const supabase = createClient();
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) {
      setErrorBanner(
        "Bahan baku tidak bisa dihapus karena masih terhubung ke resep menu. Hapus dari resep terlebih dahulu."
      );
      return;
    }
    await reloadData();
  };

  const handleSaveOpname = async (e: FormEvent) => {
    e.preventDefault();
    if (!opnameTarget) return;
    setSavingOpname(true);
    setErrorBanner(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("adjust_ingredient_stock", {
        p_ingredient_id: opnameTarget.id,
        p_new_stock: Number(opnameNewStock) || 0,
        p_notes: opnameNotes.trim() || "Stock opname manual",
      });
      if (error) throw new Error(error.message);
      setOpnameTarget(null);
      setOpnameNotes("");
      await reloadData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Gagal menyimpan opname.");
    } finally {
      setSavingOpname(false);
    }
  };

  const handleSaveWaste = async (e: FormEvent) => {
    e.preventDefault();
    if (!wasteTarget) return;
    setSavingWaste(true);
    setErrorBanner(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("record_kitchen_waste", {
        p_ingredient_id: wasteTarget.id,
        p_quantity: Number(wasteQty) || 0,
        p_reason: wasteReason.trim(),
      });
      if (error) throw new Error(error.message);
      setWasteTarget(null);
      setWasteQty("");
      await reloadData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Gagal mencatat bahan sisa.");
    } finally {
      setSavingWaste(false);
    }
  };

  return (
    <div className="space-y-4">
      {errorBanner ? (
        <ErrorState title="Terjadi kesalahan stok" message={errorBanner} onRetry={reloadData} />
      ) : null}

      {/* Top Action & Filter Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab("stock")}
            className={`min-h-10 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
              activeTab === "stock"
                ? "bg-[#14532D] text-white"
                : "bg-white/75 text-[#1C1917] hover:bg-white"
            }`}
          >
            Daftar Bahan ({ingredients.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("movements")}
            className={`min-h-10 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
              activeTab === "movements"
                ? "bg-[#14532D] text-white"
                : "bg-white/75 text-[#1C1917] hover:bg-white"
            }`}
          >
            <ClockCounterClockwise size={16} weight="bold" aria-hidden="true" />
            Riwayat Mutasi
          </button>
          {criticalCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setActiveTab("stock");
                setOnlyCritical((v) => !v);
              }}
              className={`min-h-10 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold border transition-colors ${
                onlyCritical
                  ? "bg-[#B43D0A] text-white border-[#B43D0A]"
                  : "bg-[#FEF3C7] text-[#92400E] border-[#92400E]/25"
              }`}
            >
              <Warning size={16} weight="bold" aria-hidden="true" />
              Perlu Perhatian ({criticalCount})
            </button>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {activeTab === "stock" ? (
            <div className="relative flex-1 sm:w-64">
              <MagnifyingGlass
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#44403C]"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari bahan baku"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari beras, minyak, cup..."
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 pl-9 pr-3.5 py-2 text-sm text-[#1C1917]"
              />
            </div>
          ) : null}

          {isOwner ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
            >
              <Plus size={18} weight="bold" aria-hidden="true" />
              Tambah Bahan
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === "stock" ? (
        filteredIngredients.length === 0 ? (
          <EmptyState
            title={
              ingredients.length === 0
                ? "Belum ada bahan baku atau kemasan"
                : "Tidak ada bahan yang cocok dengan filter"
            }
            description={
              ingredients.length === 0
                ? "Tambahkan bahan baku seperti beras, daging ayam, minyak goreng, atau kemasan cup untuk mulai menghitung HPP dan memotong stok otomatis."
                : "Coba hapus kata kunci pencarian atau matikan filter stok kritis."
            }
            action={
              isOwner && ingredients.length === 0 ? (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-bold text-white"
                >
                  <Plus size={18} weight="bold" aria-hidden="true" />
                  Tambah Bahan Pertama
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredIngredients.map((item) => {
              const current = Number(item.current_stock);
              const minimum = Number(item.minimum_stock);
              const isOut = current <= 0;
              const isLow = current > 0 && current <= minimum;
              const expDays = getExpiryDiffDays(item.nearest_expiry_date);
              const nearExpiry = expDays !== null && expDays <= 7;

              return (
                <article
                  key={item.id}
                  className="glass-panel rounded-2xl p-4 flex flex-col justify-between gap-3.5"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-bold text-[#1C1917] leading-snug">
                        {item.name}
                      </h2>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-[#B91C1C] text-white px-2 py-0.5 text-[11px] font-bold">
                            <WarningCircle size={12} weight="bold" aria-hidden="true" />
                            Habis
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[11px] font-bold">
                            <Warning size={12} weight="bold" aria-hidden="true" />
                            Menipis
                          </span>
                        ) : (
                          <span className="rounded-lg bg-[#14532D]/12 text-[#14532D] px-2 py-0.5 text-[11px] font-bold">
                            Aman
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between gap-2 pt-1">
                      <div>
                        <p className="text-xs text-[#44403C]">Stok Tersedia</p>
                        <p className="text-2xl font-extrabold text-[#1C1917] tabular-nums">
                          {formatNumber(current)}{" "}
                          <span className="text-sm font-semibold text-[#44403C]">
                            {item.unit}
                          </span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#44403C]">Min. Peringatan</p>
                        <p className="text-sm font-semibold text-[#1C1917] tabular-nums">
                          {formatNumber(minimum)} {item.unit}
                        </p>
                      </div>
                    </div>

                    {isOwner && "cost_per_unit" in item ? (
                      <p className="text-xs text-[#44403C] tabular-nums">
                        Harga beli rata-rata:{" "}
                        <span className="font-semibold text-[#1C1917]">
                          {formatRupiah(item.cost_per_unit)}
                        </span>{" "}
                        / {item.unit}
                      </p>
                    ) : null}

                    {item.nearest_expiry_date ? (
                      <p
                        className={`text-xs font-medium ${
                          nearExpiry ? "text-[#B43D0A] font-bold" : "text-[#44403C]"
                        }`}
                      >
                        {expDays !== null && expDays <= 0
                          ? "Sudah lewat tanggal kedaluwarsa"
                          : nearExpiry
                            ? `Kedaluwarsa ${expDays} hari lagi (${formatDateId(item.nearest_expiry_date)})`
                            : `Kedaluwarsa: ${formatDateId(item.nearest_expiry_date)}`}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#1C1917]/10 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setWasteTarget(item);
                        setWasteQty("");
                      }}
                      className="min-h-10 flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#B43D0A]/30 bg-white/80 px-3 py-1.5 text-xs font-bold text-[#B43D0A] hover:bg-orange-50"
                    >
                      Catat Waste
                    </button>

                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setOpnameTarget(item);
                            setOpnameNewStock(String(item.current_stock));
                          }}
                          className="min-h-10 flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-white"
                        >
                          <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />
                          Opname
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(item as Ingredient)}
                          aria-label={`Edit ${item.name}`}
                          className="min-h-10 min-w-10 rounded-xl border border-[#1C1917]/15 bg-white/80 inline-flex items-center justify-center text-[#1C1917] hover:bg-white"
                        >
                          <PencilSimple size={16} weight="bold" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteIngredient(item.id)}
                          aria-label={`Hapus ${item.name}`}
                          className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white/80 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                        >
                          <Trash size={16} weight="bold" aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : movements.length === 0 ? (
        <EmptyState
          title="Belum ada riwayat mutasi stok"
          description="Setiap transaksi kasir, scan struk belanja, waste dapur, atau stock opname akan tercatat otomatis di sini."
        />
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-black/5 text-[#44403C]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Waktu</th>
                  <th className="px-4 py-3 font-semibold">Bahan</th>
                  <th className="px-4 py-3 font-semibold">Jenis</th>
                  <th className="px-4 py-3 font-semibold text-right">Perubahan</th>
                  <th className="px-4 py-3 font-semibold">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C1917]/10">
                {movements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-white/40">
                    <td className="px-4 py-3 whitespace-nowrap text-[#44403C]">
                      {formatDateId(mov.created_at, true)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#1C1917]">
                      {mov.ingredient?.name ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-black/5 px-2 py-0.5 text-xs font-semibold text-[#1C1917]">
                        {MOVEMENT_LABELS[mov.movement_type]}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${
                        Number(mov.quantity_delta) >= 0 ? "text-[#14532D]" : "text-[#B43D0A]"
                      }`}
                    >
                      {Number(mov.quantity_delta) >= 0 ? "+" : ""}
                      {formatNumber(mov.quantity_delta)} {mov.ingredient?.unit ?? ""}
                    </td>
                    <td className="px-4 py-3 text-[#44403C]">{mov.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Bahan (Owner) */}
      <Modal
        open={ingModalOpen}
        onClose={() => setIngModalOpen(false)}
        title={editingIng ? "Edit Bahan Baku" : "Tambah Bahan Baku Baru"}
      >
        <form onSubmit={handleSaveIngredient} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="ingName" className="block text-sm font-semibold text-[#1C1917]">
              Nama Bahan / Kemasan
            </label>
            <input
              id="ingName"
              type="text"
              required
              value={ingName}
              onChange={(e) => setIngName(e.target.value)}
              placeholder="Contoh: Beras Pandan Wangi, Cup 16oz, Minyak Goreng"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="ingUnit" className="block text-sm font-semibold text-[#1C1917]">
                Satuan Pakai Resep
              </label>
              <select
                id="ingUnit"
                value={ingUnit}
                onChange={(e) => setIngUnit(e.target.value as IngredientUnit)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ingCost" className="block text-sm font-semibold text-[#1C1917]">
                Harga Beli / {ingUnit} (Rp)
              </label>
              <input
                id="ingCost"
                type="number"
                step="0.01"
                min="0"
                required
                value={ingCost}
                onChange={(e) => setIngCost(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="ingStock" className="block text-sm font-semibold text-[#1C1917]">
                Stok Saat Ini ({ingUnit})
              </label>
              <input
                id="ingStock"
                type="number"
                step="0.01"
                required
                value={ingStock}
                onChange={(e) => setIngStock(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ingMinStock" className="block text-sm font-semibold text-[#1C1917]">
                Batas Minimum ({ingUnit})
              </label>
              <input
                id="ingMinStock"
                type="number"
                step="0.01"
                min="0"
                required
                value={ingMinStock}
                onChange={(e) => setIngMinStock(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ingExpiry" className="block text-sm font-semibold text-[#1C1917]">
              Tanggal Kedaluwarsa Terdekat (Opsional)
            </label>
            <input
              id="ingExpiry"
              type="date"
              value={ingExpiry}
              onChange={(e) => setIngExpiry(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIngModalOpen(false)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 py-2 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={savingIng}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 py-2 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60"
            >
              {savingIng ? "Menyimpan..." : "Simpan Bahan"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Stock Opname */}
      <Modal
        open={Boolean(opnameTarget)}
        onClose={() => setOpnameTarget(null)}
        title={`Stock Opname: ${opnameTarget?.name ?? ""}`}
        description="Sesuaikan stok sistem agar cocok dengan hasil hitung fisik di dapur."
      >
        <form onSubmit={handleSaveOpname} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="opnameQty" className="block text-sm font-semibold text-[#1C1917]">
              Jumlah Stok Fisik ({opnameTarget?.unit})
            </label>
            <input
              id="opnameQty"
              type="number"
              step="0.01"
              required
              value={opnameNewStock}
              onChange={(e) => setOpnameNewStock(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="opnameNotes" className="block text-sm font-semibold text-[#1C1917]">
              Catatan Opname
            </label>
            <input
              id="opnameNotes"
              type="text"
              value={opnameNotes}
              onChange={(e) => setOpnameNotes(e.target.value)}
              placeholder="Contoh: Hitung fisik akhir minggu"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpnameTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 py-2 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={savingOpname}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 py-2 text-sm font-bold text-white"
            >
              {savingOpname ? "Menyimpan..." : "Simpan Opname"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Catat Waste / Bahan Sisa */}
      <Modal
        open={Boolean(wasteTarget)}
        onClose={() => setWasteTarget(null)}
        title={`Catat Bahan Sisa / Waste: ${wasteTarget?.name ?? ""}`}
        description="Stok akan otomatis berkurang dan tercatat di riwayat mutasi dapur."
      >
        <form onSubmit={handleSaveWaste} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="wasteQty" className="block text-sm font-semibold text-[#1C1917]">
              Jumlah Terbuang ({wasteTarget?.unit})
            </label>
            <input
              id="wasteQty"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={wasteQty}
              onChange={(e) => setWasteQty(e.target.value)}
              placeholder="0"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917] tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wasteReason" className="block text-sm font-semibold text-[#1C1917]">
              Alasan Bahan Sisa / Rusak
            </label>
            <input
              id="wasteReason"
              type="text"
              required
              value={wasteReason}
              onChange={(e) => setWasteReason(e.target.value)}
              placeholder="Contoh: Basi, tumpah, gosong"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setWasteTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 py-2 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={savingWaste}
              className="min-h-11 rounded-xl bg-[#B43D0A] px-5 py-2 text-sm font-bold text-white"
            >
              {savingWaste ? "Mencatat..." : "Potong Stok Waste"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Camera, CheckCircle, PencilSimple, Receipt, Trash } from "@phosphor-icons/react";
import { formatDateId, formatRupiah } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { Expense, ExpenseCategory } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";

const CATEGORIES: Array<"Semua" | ExpenseCategory> = [
  "Semua",
  "Bahan Baku",
  "Kemasan",
  "Sewa",
  "Gaji",
  "Listrik",
  "Operasional",
];

const EDIT_CATEGORIES: ExpenseCategory[] = [
  "Bahan Baku",
  "Kemasan",
  "Sewa",
  "Gaji",
  "Listrik",
  "Operasional",
];

interface EditItemDraft {
  id: string;
  item_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  subtotal: string;
}

interface ExpensesListClientProps {
  initialExpenses: Expense[];
}

export function ExpensesListClient({ initialExpenses }: ExpensesListClientProps) {
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [categoryFilter, setCategoryFilter] = useState<"Semua" | ExpenseCategory>("Semua");

  useEffect(() => {
    setExpenses(initialExpenses);
  }, [initialExpenses]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit Modal state
  const [editingTarget, setEditingTarget] = useState<Expense | null>(null);
  const [editSupplier, setEditSupplier] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState<ExpenseCategory>("Bahan Baku");
  const [editDate, setEditDate] = useState("");
  const [editSource, setEditSource] = useState<"cash" | "bank" | "qris">("cash");
  const [editTax, setEditTax] = useState("0");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editAmount, setEditAmount] = useState("0");
  const [editItems, setEditItems] = useState<EditItemDraft[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEditModal = (exp: Expense) => {
    setEditingTarget(exp);
    setEditSupplier(exp.supplier_name ?? "");
    setEditDescription(exp.description ?? "");
    setEditCategory(exp.category);
    setEditDate(exp.expense_date);
    setEditSource(exp.payment_source);
    setEditTax(String(Number(exp.tax_amount || 0)));
    setEditDiscount(String(Number(exp.discount_amount || 0)));
    setEditAmount(String(Number(exp.amount || 0)));
    setEditItems(
      (exp.expense_items ?? []).map((it) => ({
        id: it.id,
        item_name: it.item_name,
        unit: it.unit || "pcs",
        quantity: String(Number(it.quantity)),
        unit_price: String(Number(it.unit_price)),
        subtotal: String(Number(it.subtotal)),
      }))
    );
    setEditError(null);
  };

  const syncTotalFromItems = (itemsList: EditItemDraft[], taxStr: string, discStr: string) => {
    if (itemsList.length === 0) return;
    const sumItems = itemsList.reduce((s, row) => s + (Number(row.subtotal) || 0), 0);
    const tax = Number(taxStr) || 0;
    const disc = Number(discStr) || 0;
    setEditAmount(String(Math.max(0, Math.round(sumItems + tax - disc))));
  };

  const updateEditItem = (idx: number, patch: Partial<EditItemDraft>) => {
    setEditItems((prev) => {
      const nextList = prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if ("quantity" in patch || "unit_price" in patch) {
          const q = Number(next.quantity) || 0;
          const p = Number(next.unit_price) || 0;
          next.subtotal = String(Math.round(q * p));
        }
        return next;
      });
      syncTotalFromItems(nextList, editTax, editDiscount);
      return nextList;
    });
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;
    setSavingEdit(true);
    setEditError(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        supplier_name: editSupplier.trim(),
        description: editDescription.trim(),
        category: editCategory,
        expense_date: editDate,
        payment_source: editSource,
        tax_amount: Math.max(0, Number(editTax) || 0),
        discount_amount: Math.max(0, Number(editDiscount) || 0),
        amount: Math.max(0, Number(editAmount) || 0),
        items:
          editItems.length > 0
            ? editItems.map((it) => ({
                id: it.id,
                item_name: it.item_name.trim(),
                quantity: Math.max(0.0001, Number(it.quantity) || 1),
                unit_price: Math.max(0, Number(it.unit_price) || 0),
                subtotal: Math.max(0, Number(it.subtotal) || 0),
              }))
            : undefined,
      };

      const res = await fetch(`/api/expenses/${editingTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error ?? "Gagal menyimpan perubahan pengeluaran.");
        return;
      }

      const updated = json.expense as Expense;
      setExpenses((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      void broadcastBusinessUpdate(
        updated.user_id,
        json.touchedStock ? "stock" : "expenses"
      );
      setEditingTarget(null);
      setSuccessMsg(
        json.touchedStock
          ? "Catatan pengeluaran, rincian harga, serta HPP/stok bahan baku berhasil diperbarui."
          : "Catatan pengeluaran dan nominal harga berhasil diperbarui."
      );
      router.refresh();
    } catch {
      setEditError("Gangguan jaringan saat menyimpan perubahan pengeluaran.");
    } finally {
      setSavingEdit(false);
    }
  };

  const filtered = useMemo(() => {
    return expenses.filter(
      (exp) => categoryFilter === "Semua" || exp.category === categoryFilter
    );
  }, [expenses, categoryFilter]);

  const totalFiltered = useMemo(
    () => filtered.reduce((sum, e) => sum + Number(e.amount), 0),
    [filtered]
  );

  const handleViewReceipt = async (expense: Expense) => {
    if (!expense.receipt_image_url) return;
    setLoadingReceiptId(expense.id);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/receipt-url?path=${encodeURIComponent(expense.receipt_image_url)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal memuat foto struk");
      setReceiptModalUrl(json.url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat foto struk");
    } finally {
      setLoadingReceiptId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/expenses/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? "Gagal menghapus catatan pengeluaran.");
        return;
      }

      setExpenses((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      void broadcastBusinessUpdate(deleteTarget.user_id, "expenses");
      setSuccessMsg(
        "Catatan pengeluaran berhasil dihapus. Penambahan stok terkait (jika ada) ikut ditarik kembali."
      );
      setDeleteTarget(null);
    } catch {
      setErrorMsg("Gangguan jaringan saat menghapus catatan pengeluaran.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {errorMsg ? <ErrorState message={errorMsg} /> : null}
      {successMsg ? (
        <div
          role="status"
          className="rounded-2xl border border-[#14532D]/30 bg-emerald-50/90 px-4 py-3 text-sm text-[#1C1917] flex items-center gap-2.5"
        >
          <CheckCircle size={20} weight="bold" className="text-[#14532D]" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      ) : null}

      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {CATEGORIES.map((cat) => (
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

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <div className="text-left lg:text-right">
            <p className="text-[11px] text-[#44403C]">Total Pengeluaran Terpilih</p>
            <p className="text-base font-extrabold text-[#B43D0A] tabular-nums">
              {formatRupiah(totalFiltered)}
            </p>
          </div>

          <Link
            href="/pengeluaran/scan"
            className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#9A3412] transition-colors shrink-0"
          >
            <Camera size={18} weight="bold" aria-hidden="true" />
            Scan Struk / Catat
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Belum ada catatan pengeluaran"
          description="Foto struk belanja bahan baku, kemasan, atau catat biaya operasional seperti listrik dan gaji agar laporan laba bersih akurat."
          action={
            <Link
              href="/pengeluaran/scan"
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-2.5 text-sm font-bold text-white"
            >
              <Camera size={18} weight="bold" aria-hidden="true" />
              Scan Struk Pertama
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((exp) => (
            <article
              key={exp.id}
              className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-lg bg-[#14532D]/10 text-[#14532D] px-2 py-0.5 text-xs font-bold">
                    {exp.category}
                  </span>
                  <span className="text-xs text-[#44403C]">
                    {formatDateId(exp.expense_date)}
                  </span>
                  {exp.supplier_name ? (
                    <span className="text-xs font-semibold text-[#1C1917]">
                      · {exp.supplier_name}
                    </span>
                  ) : null}
                </div>
                <h2 className="text-sm sm:text-base font-bold text-[#1C1917]">
                  {exp.description || exp.supplier_name || "Pengeluaran Usaha"}
                </h2>
                {exp.expense_items && exp.expense_items.length > 0 ? (
                  <p className="text-xs text-[#44403C] truncate">
                    {exp.expense_items.length} item:{" "}
                    {exp.expense_items.map((it) => it.item_name).join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <p className="text-base sm:text-lg font-extrabold text-[#B43D0A] tabular-nums">
                  {formatRupiah(exp.amount)}
                </p>

                <div className="flex items-center gap-1.5">
                  {exp.receipt_image_url ? (
                    <button
                      type="button"
                      onClick={() => handleViewReceipt(exp)}
                      disabled={loadingReceiptId === exp.id}
                      className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/85 px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-white cursor-pointer"
                    >
                      <Receipt size={15} weight="duotone" aria-hidden="true" />
                      {loadingReceiptId === exp.id ? "Memuat..." : "Foto Struk"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openEditModal(exp)}
                    aria-label={`Edit pengeluaran ${exp.description || exp.category}`}
                    className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-white/85 px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-emerald-50 cursor-pointer"
                  >
                    <PencilSimple size={15} weight="bold" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(exp)}
                    aria-label={`Hapus pengeluaran ${exp.description || exp.category}`}
                    className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white/85 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                  >
                    <Trash size={16} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(receiptModalUrl)}
        onClose={() => setReceiptModalUrl(null)}
        title="Foto Struk Belanja"
      >
        {receiptModalUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={receiptModalUrl}
            alt="Foto struk pengeluaran"
            width={400}
            height={600}
            className="w-full max-h-[70dvh] object-contain rounded-xl bg-white"
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editingTarget)}
        onClose={() => setEditingTarget(null)}
        title="Edit Catatan Pengeluaran"
        description="Perbaiki nominal harga, rincian item, tanggal, atau kategori jika terjadi salah input."
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          {editError ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2 text-xs text-[#B91C1C]"
            >
              {editError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="editExpCat" className="block text-xs font-semibold text-[#1C1917]">
                Kategori
              </label>
              <select
                id="editExpCat"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value as ExpenseCategory)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              >
                {EDIT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="editExpDate" className="block text-xs font-semibold text-[#1C1917]">
                Tanggal
              </label>
              <input
                id="editExpDate"
                type="date"
                required
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="editExpSup" className="block text-xs font-semibold text-[#1C1917]">
                Toko / Supplier
              </label>
              <input
                id="editExpSup"
                type="text"
                value={editSupplier}
                onChange={(e) => setEditSupplier(e.target.value)}
                placeholder="Nama toko / supplier"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="editExpSrc" className="block text-xs font-semibold text-[#1C1917]">
                Sumber Dana
              </label>
              <select
                id="editExpSrc"
                value={editSource}
                onChange={(e) =>
                  setEditSource(e.target.value as "cash" | "bank" | "qris")
                }
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              >
                <option value="cash">Tunai</option>
                <option value="bank">Transfer Bank</option>
                <option value="qris">QRIS</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="editExpDesc" className="block text-xs font-semibold text-[#1C1917]">
              Keterangan Pengeluaran
            </label>
            <input
              id="editExpDesc"
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Contoh: Belanja bahan baku"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
            />
          </div>

          {editItems.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-[#1C1917]/15 bg-black/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#1C1917]">
                  Rincian Harga Item ({editItems.length} item)
                </p>
                <button
                  type="button"
                  onClick={() => syncTotalFromItems(editItems, editTax, editDiscount)}
                  className="text-[11px] font-bold text-[#14532D] hover:underline cursor-pointer"
                >
                  Hitung Ulang Total
                </button>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                {editItems.map((it, idx) => (
                  <div
                    key={it.id}
                    className="rounded-xl border border-[#1C1917]/10 bg-white p-2.5 space-y-2"
                  >
                    <input
                      type="text"
                      aria-label={`Nama item ${idx + 1}`}
                      value={it.item_name}
                      onChange={(e) =>
                        updateEditItem(idx, { item_name: e.target.value })
                      }
                      className="min-h-9 w-full rounded-lg border border-[#1C1917]/15 px-2.5 text-xs font-semibold text-[#1C1917]"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label
                          htmlFor={`qty-${it.id}`}
                          className="block text-[10px] font-medium text-[#44403C]"
                        >
                          Qty ({it.unit})
                        </label>
                        <input
                          id={`qty-${it.id}`}
                          type="number"
                          min="0.0001"
                          step="any"
                          value={it.quantity}
                          onChange={(e) =>
                            updateEditItem(idx, { quantity: e.target.value })
                          }
                          className="min-h-9 w-full rounded-lg border border-[#1C1917]/15 px-2 text-xs font-bold text-[#1C1917] tabular-nums"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`price-${it.id}`}
                          className="block text-[10px] font-medium text-[#44403C]"
                        >
                          Harga Satuan
                        </label>
                        <input
                          id={`price-${it.id}`}
                          type="number"
                          min="0"
                          step="1"
                          value={it.unit_price}
                          onChange={(e) =>
                            updateEditItem(idx, { unit_price: e.target.value })
                          }
                          className="min-h-9 w-full rounded-lg border border-[#1C1917]/15 px-2 text-xs font-bold text-[#1C1917] tabular-nums"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`sub-${it.id}`}
                          className="block text-[10px] font-medium text-[#44403C]"
                        >
                          Subtotal
                        </label>
                        <input
                          id={`sub-${it.id}`}
                          type="number"
                          min="0"
                          step="1"
                          value={it.subtotal}
                          onChange={(e) =>
                            updateEditItem(idx, { subtotal: e.target.value })
                          }
                          className="min-h-9 w-full rounded-lg border border-[#1C1917]/15 px-2 text-xs font-extrabold text-[#B43D0A] tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="editExpTax" className="block text-xs font-semibold text-[#1C1917]">
                Pajak (Rp)
              </label>
              <input
                id="editExpTax"
                type="number"
                min="0"
                step="1"
                value={editTax}
                onChange={(e) => {
                  setEditTax(e.target.value);
                  syncTotalFromItems(editItems, e.target.value, editDiscount);
                }}
                className="min-h-10 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm tabular-nums"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="editExpDisc" className="block text-xs font-semibold text-[#1C1917]">
                Diskon (Rp)
              </label>
              <input
                id="editExpDisc"
                type="number"
                min="0"
                step="1"
                value={editDiscount}
                onChange={(e) => {
                  setEditDiscount(e.target.value);
                  syncTotalFromItems(editItems, editTax, e.target.value);
                }}
                className="min-h-10 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="editExpTotal" className="block text-xs font-semibold text-[#1C1917]">
              Total Pengeluaran Akhir (Rp)
            </label>
            <input
              id="editExpTotal"
              type="number"
              min="0"
              step="1"
              required
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-lg font-extrabold text-[#B43D0A] tabular-nums"
            />
            <p className="text-xs font-semibold text-[#44403C] tabular-nums">
              Terbaca: {formatRupiah(Number(editAmount) || 0)}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditingTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-4 text-sm font-semibold text-[#1C1917] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
            >
              {savingEdit ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Catatan Pengeluaran?"
        description="Tindakan ini akan membatalkan catatan belanja dan stok yang sempat tersinkron."
      >
        <div className="space-y-4">
          <p className="text-sm text-[#1C1917] leading-relaxed">
            Hapus pengeluaran{" "}
            <strong className="text-[#1C1917]">
              {deleteTarget?.description || deleteTarget?.supplier_name || deleteTarget?.category}
            </strong>{" "}
            senilai{" "}
            <strong className="tabular-nums text-[#B43D0A]">
              {formatRupiah(deleteTarget?.amount)}
            </strong>
            ? Jika catatan ini menambah stok bahan baku, jumlah stok tersebut akan otomatis
            dikurangi kembali.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleConfirmDelete}
              className="min-h-11 rounded-xl bg-[#B91C1C] px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {deleting ? "Menghapus..." : "Ya, Hapus Pengeluaran"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Camera, CheckCircle, Receipt, Trash } from "@phosphor-icons/react";
import { formatDateId, formatRupiah } from "@/lib/format";
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

interface ExpensesListClientProps {
  initialExpenses: Expense[];
}

export function ExpensesListClient({ initialExpenses }: ExpensesListClientProps) {
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [categoryFilter, setCategoryFilter] = useState<"Semua" | ExpenseCategory>("Semua");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

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
                      className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/85 px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-white"
                    >
                      <Receipt size={15} weight="duotone" aria-hidden="true" />
                      {loadingReceiptId === exp.id ? "Memuat..." : "Foto Struk"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(exp)}
                    aria-label={`Hapus pengeluaran ${exp.description || exp.category}`}
                    className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white/85 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
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

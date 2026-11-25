"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePdf, FileXls, Printer, Trash } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import {
  computeCapitalSummary,
  computeFinancialSummary,
  isMissingTableError,
  toJakartaDateKey,
} from "@/lib/analytics";
import { formatDateId, formatRupiah, PAYMENT_METHOD_LABELS } from "@/lib/format";
import { downloadFinancialPdf } from "@/lib/export/pdf-report";
import type { CapitalEntry, Expense, Order } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/StatePanel";

type DatePreset = "today" | "yesterday" | "7d" | "month" | "custom";

function getPresetDates(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const today = toJakartaDateKey(now);

  if (preset === "today") return { start: today, end: today };

  if (preset === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const y = toJakartaDateKey(d);
    return { start: y, end: y };
  }

  if (preset === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { start: toJakartaDateKey(d), end: today };
  }

  // Month to date
  const [yr, mo] = today.split("-");
  return { start: `${yr}-${mo}-01`, end: today };
}

interface ReportsClientProps {
  businessId: string;
  businessName: string;
  initialStart: string;
  initialEnd: string;
  initialOrders: Order[];
  initialExpenses: Expense[];
  initialCapitals?: CapitalEntry[];
}

export function ReportsClient({
  businessId,
  businessName,
  initialStart,
  initialEnd,
  initialOrders,
  initialExpenses,
  initialCapitals = [],
}: ReportsClientProps) {
  const [preset, setPreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [capitals, setCapitals] = useState<CapitalEntry[]>(initialCapitals);
  const [activeTab, setActiveTab] = useState<"pnl" | "cashflow">("pnl");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "order"; id: string; label: string; amount: number }
    | { kind: "expense"; id: string; label: string; amount: number }
    | null
  >(null);
  const [deletingItem, setDeletingItem] = useState(false);

  const loadPeriod = useCallback(
    async (start: string, end: string) => {
      if (!start || !end) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const startIso = `${start}T00:00:00+07:00`;
        const endIso = `${end}T23:59:59+07:00`;

        const [
          { data: ordData, error: ordErr },
          { data: expData, error: expErr },
          { data: capData, error: capErr },
        ] = await Promise.all([
          supabase
            .from("orders")
            .select("*")
            .eq("user_id", businessId)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false }),
          supabase
            .from("expenses")
            .select("*")
            .eq("user_id", businessId)
            .gte("expense_date", start)
            .lte("expense_date", end)
            .order("expense_date", { ascending: false }),
          supabase
            .from("capital_entries")
            .select("*")
            .eq("user_id", businessId)
            .gte("entry_date", start)
            .lte("entry_date", end)
            .order("entry_date", { ascending: false }),
        ]);

        if (ordErr) throw new Error(ordErr.message);
        if (expErr) throw new Error(expErr.message);
        if (capErr && !isMissingTableError(capErr, "capital_entries")) {
          throw new Error(capErr.message);
        }

        setOrders((ordData as Order[] | null) ?? []);
        setExpenses((expData as Expense[] | null) ?? []);
        setCapitals(
          capErr && isMissingTableError(capErr, "capital_entries")
            ? []
            : ((capData as CapitalEntry[] | null) ?? [])
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Gagal memuat laporan.");
      } finally {
        setLoading(false);
      }
    },
    [businessId]
  );

  const handlePresetClick = (p: DatePreset) => {
    setPreset(p);
    if (p === "custom") return;
    const { start, end } = getPresetDates(p);
    setStartDate(start);
    setEndDate(end);
    void loadPeriod(start, end);
  };

  useEffect(() => {
    if (preset === "custom" && startDate && endDate && startDate <= endDate) {
      void loadPeriod(startDate, endDate);
    }
  }, [preset, startDate, endDate, loadPeriod]);

  const summary = useMemo(
    () => computeFinancialSummary(orders, expenses),
    [orders, expenses]
  );
  const capitalSummary = useMemo(() => computeCapitalSummary(capitals), [capitals]);

  const handleExportExcel = () => {
    window.location.href = `/api/export/excel?start=${encodeURIComponent(
      startDate
    )}&end=${encodeURIComponent(endDate)}`;
  };

  const handleExportPdf = () => {
    downloadFinancialPdf({
      businessName,
      startDate,
      endDate,
      summary,
      orders,
      expenses,
    });
  };

  return (
    <div className="space-y-5">
      {/* Filter & Export Bar */}
      <section className="no-print glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                { key: "today", label: "Hari Ini" },
                { key: "yesterday", label: "Kemarin" },
                { key: "7d", label: "7 Hari" },
                { key: "month", label: "Bulan Ini" },
                { key: "custom", label: "Pilih Tanggal" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handlePresetClick(opt.key)}
                className={`min-h-10 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                  preset === opt.key
                    ? "bg-[#14532D] text-white"
                    : "bg-white/80 text-[#1C1917] hover:bg-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleExportExcel}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#166534]"
            >
              <FileXls size={18} weight="bold" aria-hidden="true" />
              Ekspor Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#B43D0A] px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#9A3412]"
            >
              <FilePdf size={18} weight="bold" aria-hidden="true" />
              Unduh PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1C1917]"
            >
              <Printer size={16} weight="bold" aria-hidden="true" />
              Cetak
            </button>
          </div>
        </div>

        {preset === "custom" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 max-w-md">
            <div className="space-y-1">
              <label htmlFor="startD" className="block text-xs font-semibold text-[#1C1917]">
                Dari Tanggal
              </label>
              <input
                id="startD"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="endD" className="block text-xs font-semibold text-[#1C1917]">
                Sampai Tanggal
              </label>
              <input
                id="endD"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm"
              />
            </div>
          </div>
        ) : null}
      </section>

      {errorMsg ? (
        <ErrorState message={errorMsg} onRetry={() => loadPeriod(startDate, endDate)} />
      ) : null}

      {loading ? (
        <LoadingState label="Menghitung laporan keuangan..." rows={3} />
      ) : (
        <>
          {/* Print Header */}
          <div className="hidden print-only mb-4">
            <h2 className="text-xl font-bold">{businessName || "KulinerKas"}</h2>
            <p className="text-sm">
              Laporan Keuangan Periode {startDate} s/d {endDate}
            </p>
          </div>

          {/* Report View Tabs */}
          <div className="no-print flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("pnl")}
              className={`min-h-10 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold ${
                activeTab === "pnl"
                  ? "bg-[#14532D] text-white"
                  : "glass-panel text-[#1C1917]"
              }`}
            >
              Laba Rugi (P&L)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cashflow")}
              className={`min-h-10 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold ${
                activeTab === "cashflow"
                  ? "bg-[#14532D] text-white"
                  : "glass-panel text-[#1C1917]"
              }`}
            >
              Arus Kas & Riwayat ({orders.length + expenses.length + capitals.length})
            </button>
          </div>

          {activeTab === "pnl" ? (
            <section className="glass-elevated rounded-2xl p-5 sm:p-6 space-y-4 max-w-3xl">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
                  Laporan Laba Rugi Sederhana ({startDate} s/d {endDate})
                </h2>
                <p className="text-xs text-[#44403C]">
                  Menghitung profitabilitas penjualan menu setelah HPP resep dan biaya
                  operasional.
                </p>
              </div>

              <div className="divide-y divide-[#1C1917]/10 text-sm tabular-nums">
                <div className="py-3 flex justify-between gap-4">
                  <span className="font-semibold text-[#1C1917]">
                    Omzet Penjualan ({summary.orderCount} pesanan)
                  </span>
                  <span className="font-bold text-[#14532D]">
                    {formatRupiah(summary.revenue)}
                  </span>
                </div>

                <div className="py-3 flex justify-between gap-4">
                  <span className="text-[#44403C]">(-) HPP Resep Menu Terjual</span>
                  <span className="font-semibold text-[#B43D0A]">
                    -{formatRupiah(summary.hppTotal)}
                  </span>
                </div>

                <div className="py-3 flex justify-between gap-4 bg-black/5 px-3 rounded-xl my-1">
                  <span className="font-bold text-[#1C1917]">Laba Kotor (Gross Profit)</span>
                  <span className="font-extrabold text-[#1C1917]">
                    {formatRupiah(summary.grossProfit)}
                  </span>
                </div>

                <div className="py-3 flex justify-between gap-4">
                  <span className="text-[#44403C]">
                    (-) Beban Operasional (Kemasan, Sewa, Gaji, Listrik, Lainnya)
                  </span>
                  <span className="font-semibold text-[#B43D0A]">
                    -{formatRupiah(summary.operatingExpenses)}
                  </span>
                </div>

                <div className="pt-4 pb-1 flex justify-between items-baseline gap-4">
                  <div>
                    <p className="text-base font-extrabold text-[#1C1917]">
                      Laba Bersih (Net Profit)
                    </p>
                    <p className="text-xs text-[#44403C]">
                      Net Margin: {summary.netMarginPercent.toFixed(1)}%
                    </p>
                  </div>
                  <span
                    className={`text-xl sm:text-2xl font-extrabold ${
                      summary.netProfit < 0 ? "text-[#B91C1C]" : "text-[#14532D]"
                    }`}
                  >
                    {formatRupiah(summary.netProfit)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-[#44403C] rounded-xl bg-black/5 p-3 leading-relaxed">
                Catatan pembukuan: Pembelian kategori &quot;Bahan Baku&quot; sebesar{" "}
                <strong className="text-[#1C1917] tabular-nums">
                  {formatRupiah(summary.ingredientPurchases)}
                </strong>{" "}
                dicatat di Arus Kas Keluar dan masuk ke Laba Rugi melalui HPP porsi saat
                menu terjual, sehingga biaya bahan tidak dihitung ganda.
              </p>
            </section>
          ) : (
            <div className="space-y-5">
              {/* Cash Flow Summary */}
              <section className="glass-panel rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                <div>
                  <p className="text-xs text-[#44403C]">Total Kas Masuk (Penjualan)</p>
                  <p className="text-xl font-extrabold text-[#14532D]">
                    {formatRupiah(summary.cashInflow)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#44403C]">Total Kas Keluar (Semua Belanja)</p>
                  <p className="text-xl font-extrabold text-[#B43D0A]">
                    {formatRupiah(summary.cashOutflow)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#44403C]">Modal Usaha Bersih (Periode Ini)</p>
                  <p
                    className={`text-xl font-extrabold ${
                      capitalSummary.netCapital < 0 ? "text-[#B43D0A]" : "text-[#14532D]"
                    }`}
                  >
                    {formatRupiah(capitalSummary.netCapital)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#44403C]">Arus Kas Bersih Periode Ini</p>
                  <p
                    className={`text-xl font-extrabold ${
                      summary.netCashFlow + capitalSummary.netCapital < 0
                        ? "text-[#B91C1C]"
                        : "text-[#1C1917]"
                    }`}
                  >
                    {formatRupiah(summary.netCashFlow + capitalSummary.netCapital)}
                  </p>
                </div>
              </section>

              {orders.length === 0 && expenses.length === 0 && capitals.length === 0 ? (
                <EmptyState
                  title="Belum ada transaksi di periode ini"
                  description="Pilih rentang tanggal lain atau mulai catat transaksi kasir dan pengeluaran."
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <section className="glass-panel rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-[#1C1917]">
                      Riwayat Penjualan ({orders.length})
                    </h3>
                    {orders.length === 0 ? (
                      <p className="text-xs text-[#44403C]">Tidak ada penjualan di periode ini.</p>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {orders.map((o) => (
                          <div
                            key={o.id}
                            className="rounded-xl bg-white/80 border border-[#1C1917]/10 px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-[#1C1917] truncate">
                                {o.order_number}
                                {o.notes ? ` · ${o.notes}` : ""}
                              </p>
                              <p className="text-[#44403C]">
                                {formatDateId(o.created_at, true)} ·{" "}
                                {PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-extrabold text-[#14532D] tabular-nums">
                                +{formatRupiah(o.total_amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "order",
                                    id: o.id,
                                    label: o.order_number,
                                    amount: Number(o.total_amount),
                                  })
                                }
                                aria-label={`Hapus penjualan ${o.order_number}`}
                                className="no-print w-9 h-9 rounded-lg border border-[#B91C1C]/25 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                              >
                                <Trash size={14} weight="bold" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="glass-panel rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-[#1C1917]">
                      Riwayat Pengeluaran ({expenses.length})
                    </h3>
                    {expenses.length === 0 ? (
                      <p className="text-xs text-[#44403C]">Tidak ada pengeluaran di periode ini.</p>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {expenses.map((e) => (
                          <div
                            key={e.id}
                            className="rounded-xl bg-white/80 border border-[#1C1917]/10 px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-[#1C1917] truncate">
                                {e.description || e.supplier_name || e.category}
                              </p>
                              <p className="text-[#44403C]">
                                {formatDateId(e.expense_date)} · {e.category}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-extrabold text-[#B43D0A] tabular-nums">
                                -{formatRupiah(e.amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "expense",
                                    id: e.id,
                                    label: e.description || e.supplier_name || e.category,
                                    amount: Number(e.amount),
                                  })
                                }
                                aria-label={`Hapus pengeluaran ${e.description || e.category}`}
                                className="no-print w-9 h-9 rounded-lg border border-[#B91C1C]/25 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                              >
                                <Trash size={14} weight="bold" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {capitals.length > 0 ? (
                <section className="glass-panel rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#1C1917]">
                      Riwayat Modal Usaha ({capitals.length})
                    </h3>
                    <Link
                      href="/modal-usaha"
                      className="no-print text-xs font-bold text-[#14532D] hover:underline"
                    >
                      Kelola Modal Usaha
                    </Link>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {capitals.map((c) => {
                      const isDeposit = c.entry_type === "deposit";
                      return (
                        <div
                          key={c.id}
                          className="rounded-xl bg-white/80 border border-[#1C1917]/10 px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-[#1C1917] truncate">
                              {c.notes || (isDeposit ? "Setoran Modal" : "Tarik Modal (Prive)")}
                            </p>
                            <p className="text-[#44403C]">
                              {formatDateId(c.entry_date)} ·{" "}
                              {isDeposit ? "Setoran Modal" : "Penarikan / Prive"}
                            </p>
                          </div>
                          <span
                            className={`font-extrabold tabular-nums shrink-0 ${
                              isDeposit ? "text-[#14532D]" : "text-[#B43D0A]"
                            }`}
                          >
                            {isDeposit ? "+" : "-"}
                            {formatRupiah(c.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={
          deleteTarget?.kind === "order"
            ? `Hapus Penjualan ${deleteTarget.label}?`
            : "Hapus Catatan Pengeluaran?"
        }
        description="Stok bahan baku dan perhitungan kas terkait akan ikut disesuaikan."
      >
        <div className="space-y-4">
          <p className="text-sm text-[#1C1917] leading-relaxed">
            Anda yakin ingin menghapus{" "}
            <strong>{deleteTarget?.label}</strong> senilai{" "}
            <strong className="tabular-nums">{formatRupiah(deleteTarget?.amount)}</strong>?
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
              disabled={deletingItem}
              onClick={async () => {
                if (!deleteTarget) return;
                setDeletingItem(true);
                setErrorMsg(null);
                try {
                  const endpoint =
                    deleteTarget.kind === "order"
                      ? `/api/orders/${deleteTarget.id}`
                      : `/api/expenses/${deleteTarget.id}`;
                  const res = await fetch(endpoint, { method: "DELETE" });
                  const json = await res.json();
                  if (!res.ok) {
                    setErrorMsg(json.error ?? "Gagal menghapus catatan.");
                    return;
                  }
                  if (deleteTarget.kind === "order") {
                    setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id));
                  } else {
                    setExpenses((prev) => prev.filter((e) => e.id !== deleteTarget.id));
                  }
                  setDeleteTarget(null);
                } catch {
                  setErrorMsg("Terjadi gangguan saat menghapus data.");
                } finally {
                  setDeletingItem(false);
                }
              }}
              className="min-h-11 rounded-xl bg-[#B91C1C] px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {deletingItem ? "Menghapus..." : "Ya, Hapus"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

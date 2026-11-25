"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle,
  Coins,
  Copy,
  Database,
  PencilSimple,
  Plus,
  Trash,
  TrendUp,
  Wallet,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { computeCapitalSummary } from "@/lib/analytics";
import { formatDateId, formatRupiah } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { CapitalEntry, CapitalEntryType } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";

const SOURCE_LABELS: Record<CapitalEntry["payment_source"], string> = {
  cash: "Tunai",
  bank: "Transfer Bank",
  qris: "QRIS",
};

const CAPITAL_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS public.capital_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit', 'withdrawal')) DEFAULT 'deposit',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('cash', 'bank', 'qris')) DEFAULT 'cash',
  notes TEXT NOT NULL DEFAULT '',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capital_entries_user_date
  ON public.capital_entries(user_id, entry_date DESC);

DROP TRIGGER IF EXISTS trg_capital_entries_updated_at ON public.capital_entries;
CREATE TRIGGER trg_capital_entries_updated_at
  BEFORE UPDATE ON public.capital_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.capital_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capital_entries_owner_all ON public.capital_entries;
CREATE POLICY capital_entries_owner_all ON public.capital_entries
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND user_id = public.get_my_business_id()
  );`;

interface CapitalManagerClientProps {
  businessId: string;
  todayKey: string;
  capitalTableMissing: boolean;
  initialEntries: CapitalEntry[];
  allTimeSales: number;
  allTimeExpenses: number;
  allTimeNetProfit: number;
}

export function CapitalManagerClient({
  businessId,
  todayKey,
  capitalTableMissing,
  initialEntries,
  allTimeSales,
  allTimeExpenses,
  allTimeNetProfit,
}: CapitalManagerClientProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<CapitalEntry[]>(initialEntries);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Form Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CapitalEntry | null>(null);
  const [entryType, setEntryType] = useState<CapitalEntryType>("deposit");
  const [amountInput, setAmountInput] = useState("");
  const [paymentSource, setPaymentSource] = useState<CapitalEntry["payment_source"]>("cash");
  const [entryDate, setEntryDate] = useState(todayKey);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete Confirm Modal
  const [deleteTarget, setDeleteTarget] = useState<CapitalEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const summary = useMemo(() => computeCapitalSummary(entries), [entries]);
  const actualCashBalance = summary.netCapital + allTimeSales - allTimeExpenses;

  const roiStats = useMemo(() => {
    if (summary.totalDeposits <= 0) {
      return {
        rawPercent: 0,
        barPercent: 0,
        remaining: 0,
        isBreakEven: false,
      };
    }
    const positiveProfit = Math.max(0, allTimeNetProfit);
    const rawPercent = (positiveProfit / summary.totalDeposits) * 100;
    return {
      rawPercent,
      barPercent: Math.min(100, Math.max(0, rawPercent)),
      remaining: Math.max(0, summary.totalDeposits - positiveProfit),
      isBreakEven: allTimeNetProfit >= summary.totalDeposits,
    };
  }, [allTimeNetProfit, summary.totalDeposits]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.entry_date !== b.entry_date) {
        return b.entry_date.localeCompare(a.entry_date);
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [entries]);

  const parsedAmount = Math.max(0, Number(amountInput) || 0);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(CAPITAL_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      setErrorMsg("Gagal menyalin otomatis. Silakan blok dan salin SQL dari kotak di atas.");
    }
  };

  const openCreateModal = (type: CapitalEntryType) => {
    setEditingEntry(null);
    setEntryType(type);
    setAmountInput("");
    setPaymentSource("cash");
    setEntryDate(todayKey);
    setNotes(type === "deposit" ? "Modal awal usaha" : "Penarikan modal / prive");
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (entry: CapitalEntry) => {
    setEditingEntry(entry);
    setEntryType(entry.entry_type);
    setAmountInput(String(Math.round(Number(entry.amount))));
    setPaymentSource(entry.payment_source);
    setEntryDate(entry.entry_date);
    setNotes(entry.notes);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (parsedAmount <= 0) {
      setFormError("Nominal modal harus lebih besar dari Rp 0.");
      return;
    }

    if (!entryDate) {
      setFormError("Tanggal pencatatan wajib diisi.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();

      if (editingEntry) {
        const { data, error } = await supabase
          .from("capital_entries")
          .update({
            entry_type: entryType,
            amount: parsedAmount,
            payment_source: paymentSource,
            entry_date: entryDate,
            notes: notes.trim(),
          })
          .eq("id", editingEntry.id)
          .eq("user_id", businessId)
          .select("*")
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? "Gagal memperbarui catatan modal.");
        }

        const updated = data as CapitalEntry;
        setEntries((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        setSuccessMsg("Catatan modal usaha berhasil diperbarui.");
      } else {
        const { data, error } = await supabase
          .from("capital_entries")
          .insert({
            user_id: businessId,
            entry_type: entryType,
            amount: parsedAmount,
            payment_source: paymentSource,
            entry_date: entryDate,
            notes: notes.trim(),
          })
          .select("*")
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? "Gagal menyimpan catatan modal.");
        }

        const created = data as CapitalEntry;
        setEntries((prev) => [created, ...prev]);
        setSuccessMsg(
          entryType === "deposit"
            ? `Setoran modal sebesar ${formatRupiah(parsedAmount)} berhasil dicatat.`
            : `Penarikan modal sebesar ${formatRupiah(parsedAmount)} berhasil dicatat.`
        );
      }

      setFormOpen(false);
      void broadcastBusinessUpdate(businessId, "capital");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan catatan modal.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("capital_entries")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("user_id", businessId);

      if (error) {
        throw new Error(error.message);
      }

      setEntries((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setSuccessMsg("Catatan modal usaha berhasil dihapus dan saldo kas diperbarui.");
      setDeleteTarget(null);
      void broadcastBusinessUpdate(businessId, "capital");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menghapus catatan modal.");
    } finally {
      setDeleting(false);
    }
  };

  if (capitalTableMissing) {
    return (
      <section className="glass-elevated max-w-3xl rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] text-[#92400E] flex items-center justify-center shrink-0">
            <Database size={24} weight="duotone" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              Aktifkan Tabel Modal Usaha di Supabase
            </h2>
            <p className="text-xs sm:text-sm text-[#44403C]">
              Jalankan SQL migrasi satu kali di Supabase SQL Editor agar catatan modal usaha
              tersimpan aman di database bisnis Anda.
            </p>
          </div>
        </div>

        <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-sm text-[#1C1917]">
          <li>
            Salin script SQL di bawah ini (tersedia juga di file{" "}
            <code className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-semibold">
              supabase/migrations/002_business_capital.sql
            </code>
            ).
          </li>
          <li>Buka Dashboard Supabase proyek Anda lalu pilih menu SQL Editor.</li>
          <li>Tempel, klik Run, lalu klik tombol Muat Ulang Halaman di bawah.</li>
        </ol>

        <pre className="rounded-xl bg-[#1C1917] text-[#FAFAF9] p-3.5 text-xs overflow-x-auto leading-relaxed">
          <code>{CAPITAL_MIGRATION_SQL}</code>
        </pre>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleCopySql}
            className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#166534] transition-colors cursor-pointer"
          >
            {copiedSql ? (
              <Check size={16} weight="bold" aria-hidden="true" />
            ) : (
              <Copy size={16} weight="bold" aria-hidden="true" />
            )}
            <span>{copiedSql ? "SQL Tersalin" : "Salin SQL Migrasi"}</span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-black/5 transition-colors cursor-pointer"
          >
            Muat Ulang Halaman
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {errorMsg ? <ErrorState message={errorMsg} /> : null}
      {successMsg ? (
        <div
          role="status"
          className="rounded-2xl border border-[#14532D]/30 bg-emerald-50/90 px-4 py-3 text-sm text-[#1C1917] flex items-center gap-2.5"
        >
          <CheckCircle size={20} weight="bold" className="text-[#14532D] shrink-0" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      ) : null}

      {/* Top KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
        <div className="glass-elevated rounded-2xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#14532D]">
            <Coins size={16} weight="duotone" aria-hidden="true" />
            <span>Modal Usaha Aktif</span>
          </div>
          <p className="text-xl sm:text-2xl font-extrabold text-[#1C1917]">
            {formatRupiah(summary.netCapital)}
          </p>
          <p className="text-[11px] text-[#44403C]">Total setor dikurangi penarikan</p>
        </div>

        <div className="glass-panel rounded-2xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#14532D]">
            <ArrowDownLeft size={16} weight="bold" aria-hidden="true" />
            <span>Total Modal Disetor</span>
          </div>
          <p className="text-xl sm:text-2xl font-extrabold text-[#14532D]">
            {formatRupiah(summary.totalDeposits)}
          </p>
          <p className="text-[11px] text-[#44403C]">Modal awal + suntikan tambahan</p>
        </div>

        <div className="glass-panel rounded-2xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#B43D0A]">
            <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
            <span>Penarikan / Prive</span>
          </div>
          <p className="text-xl sm:text-2xl font-extrabold text-[#B43D0A]">
            {formatRupiah(summary.totalWithdrawals)}
          </p>
          <p className="text-[11px] text-[#44403C]">Modal ditarik kembali owner</p>
        </div>

        <div className="glass-panel rounded-2xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1C1917]">
            <Wallet size={16} weight="duotone" aria-hidden="true" />
            <span>Saldo Kas Aktual Usaha</span>
          </div>
          <p
            className={`text-xl sm:text-2xl font-extrabold ${
              actualCashBalance < 0 ? "text-[#B91C1C]" : "text-[#1C1917]"
            }`}
          >
            {formatRupiah(actualCashBalance)}
          </p>
          <p className="text-[11px] text-[#44403C]">Modal bersih + penjualan - belanja</p>
        </div>
      </section>

      {/* ROI / Break-Even Progress */}
      <section className="glass-panel rounded-2xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendUp size={20} weight="duotone" className="text-[#14532D]" aria-hidden="true" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#1C1917]">
                Progres Balik Modal (Break-Even)
              </h2>
              <p className="text-xs text-[#44403C]">
                Perbandingan akumulasi Laba Bersih usaha dengan Total Modal yang sudah disetor.
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right tabular-nums">
            <span className="text-xs text-[#44403C] block">Akumulasi Laba Bersih</span>
            <span
              className={`text-base font-extrabold ${
                allTimeNetProfit < 0 ? "text-[#B91C1C]" : "text-[#14532D]"
              }`}
            >
              {formatRupiah(allTimeNetProfit)}
            </span>
          </div>
        </div>

        <div className="w-full h-3 rounded-full bg-black/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#14532D] transition-all duration-300"
            style={{ width: `${roiStats.barPercent}%` }}
          />
        </div>

        <p className="text-xs sm:text-sm font-medium text-[#1C1917]">
          {summary.totalDeposits <= 0
            ? "Catat modal awal usaha terlebih dahulu untuk memantau target balik modal."
            : roiStats.isBreakEven
            ? `Sudah balik modal! Akumulasi laba bersih mencapai ${roiStats.rawPercent.toFixed(
                0
              )}% dari modal disetor.`
            : `Tercapai ${Math.max(0, roiStats.rawPercent).toFixed(
                1
              )}%. Perlu tambahan laba bersih ${formatRupiah(
                roiStats.remaining
              )} lagi untuk menutup seluruh modal disetor.`}
        </p>
      </section>

      {/* Action Bar + History List */}
      <section className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              Riwayat Modal Usaha ({entries.length})
            </h2>
            <p className="text-xs text-[#44403C]">
              Catat modal awal, suntikan dana tambahan, atau penarikan modal (tidak memengaruhi omzet penjualan).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openCreateModal("deposit")}
              className="min-h-11 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#166534] transition-colors cursor-pointer"
            >
              <Plus size={16} weight="bold" aria-hidden="true" />
              <span>Catat / Tambah Modal</span>
            </button>
            <button
              type="button"
              onClick={() => openCreateModal("withdrawal")}
              className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-[#B43D0A]/30 bg-white px-4 py-2 text-xs sm:text-sm font-bold text-[#B43D0A] hover:bg-orange-50 transition-colors cursor-pointer"
            >
              <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
              <span>Tarik Modal (Prive)</span>
            </button>
          </div>
        </div>

        {sortedEntries.length === 0 ? (
          <EmptyState
            title="Belum ada catatan modal usaha"
            description="Masukkan modal awal usaha Anda (misalnya sekitar Rp 170.000) agar Saldo Kas Aktual Usaha dan target balik modal terhitung akurat."
            action={
              <button
                type="button"
                onClick={() => openCreateModal("deposit")}
                className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166534] transition-colors cursor-pointer"
              >
                <Plus size={16} weight="bold" aria-hidden="true" />
                Catat Modal Awal Sekarang
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {sortedEntries.map((entry) => {
              const isDeposit = entry.entry_type === "deposit";
              return (
                <article
                  key={entry.id}
                  className="rounded-xl border border-[#1C1917]/10 bg-white/85 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          isDeposit
                            ? "bg-emerald-100 text-[#14532D]"
                            : "bg-orange-100 text-[#B43D0A]"
                        }`}
                      >
                        {isDeposit ? "Setoran Modal" : "Tarik Modal (Prive)"}
                      </span>
                      <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-semibold text-[#44403C]">
                        {SOURCE_LABELS[entry.payment_source] ?? entry.payment_source}
                      </span>
                      <span className="text-xs text-[#44403C]">{formatDateId(entry.entry_date)}</span>
                    </div>
                    <p className="text-sm font-semibold text-[#1C1917] break-words">
                      {entry.notes || (isDeposit ? "Setoran modal usaha" : "Penarikan dana pemilik")}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span
                      className={`text-base sm:text-lg font-extrabold tabular-nums ${
                        isDeposit ? "text-[#14532D]" : "text-[#B43D0A]"
                      }`}
                    >
                      {isDeposit ? "+" : "-"}
                      {formatRupiah(entry.amount)}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(entry)}
                        aria-label={`Edit catatan modal ${entry.notes || formatRupiah(entry.amount)}`}
                        className="w-10 h-10 rounded-lg border border-[#1C1917]/15 bg-white inline-flex items-center justify-center text-[#1C1917] hover:bg-black/5 cursor-pointer"
                      >
                        <PencilSimple size={16} weight="bold" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(entry)}
                        aria-label={`Hapus catatan modal ${entry.notes || formatRupiah(entry.amount)}`}
                        className="w-10 h-10 rounded-lg border border-[#B91C1C]/25 bg-white inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                      >
                        <Trash size={16} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Create / Edit Capital Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingEntry ? "Edit Catatan Modal Usaha" : "Catat Modal Usaha"}
        description="Dana ini dicatat sebagai modal usaha (ekuitas) dan otomatis menyesuaikan Saldo Kas Aktual."
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2 text-xs text-[#B91C1C]"
            >
              {formError}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: "deposit", label: "Setor / Tambah Modal" },
                { key: "withdrawal", label: "Tarik Modal (Prive)" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setEntryType(opt.key)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                  entryType === opt.key
                    ? opt.key === "deposit"
                      ? "border-[#14532D] bg-[#14532D] text-white"
                      : "border-[#B43D0A] bg-[#B43D0A] text-white"
                    : "border-[#1C1917]/20 bg-white text-[#1C1917]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capitalAmount" className="block text-xs font-semibold text-[#1C1917]">
              Nominal (Rp)
            </label>
            <input
              id="capitalAmount"
              type="number"
              min="1"
              step="1"
              required
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="Contoh: 170000"
              className="min-h-12 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-lg font-extrabold text-[#1C1917] tabular-nums"
            />
            <p className="text-xs font-semibold text-[#14532D] tabular-nums">
              Terbaca: {formatRupiah(parsedAmount)}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="capitalDate" className="block text-xs font-semibold text-[#1C1917]">
                Tanggal
              </label>
              <input
                id="capitalDate"
                type="date"
                required
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="capitalSource" className="block text-xs font-semibold text-[#1C1917]">
                Sumber / Tujuan Dana
              </label>
              <select
                id="capitalSource"
                value={paymentSource}
                onChange={(e) =>
                  setPaymentSource(e.target.value as CapitalEntry["payment_source"])
                }
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              >
                <option value="cash">Tunai</option>
                <option value="bank">Transfer Bank</option>
                <option value="qris">QRIS</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capitalNotes" className="block text-xs font-semibold text-[#1C1917]">
              Keterangan / Catatan
            </label>
            <input
              id="capitalNotes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Modal awal usaha / Tambah modal bahan"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="min-h-11 rounded-xl border border-[#1C1917]/20 bg-white px-4 py-2 text-sm font-semibold text-[#1C1917] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 py-2 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
            >
              {saving ? "Menyimpan..." : editingEntry ? "Simpan Perubahan" : "Simpan Modal"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Catatan Modal?"
        description="Saldo Kas Aktual dan progres balik modal akan dihitung ulang secara otomatis."
      >
        {deleteTarget ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-black/5 p-3 text-sm space-y-1">
              <p className="font-bold text-[#1C1917]">
                {deleteTarget.notes ||
                  (deleteTarget.entry_type === "deposit" ? "Setoran Modal" : "Tarik Modal")}
              </p>
              <p className="text-xs text-[#44403C]">
                {formatDateId(deleteTarget.entry_date)} - {formatRupiah(deleteTarget.amount)}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-11 rounded-xl border border-[#1C1917]/20 bg-white px-4 py-2 text-sm font-semibold text-[#1C1917] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  void handleConfirmDelete();
                }}
                className="min-h-11 rounded-xl bg-[#B91C1C] px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60 cursor-pointer"
              >
                {deleting ? "Menghapus..." : "Ya, Hapus Catatan"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowSquareOut,
  Check,
  CheckCircle,
  Copy,
  Database,
  Package,
  ShoppingBag,
  Trash,
  WhatsappLogo,
  XCircle,
} from "@phosphor-icons/react";
import { formatDateId, formatRupiah, normalizeWhatsAppPhone } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { CustomerOrder } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";

const CUSTOMER_ORDERS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS public.customer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'qris' CHECK (payment_method IN ('qris')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'rejected')),
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  linked_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  paid_verified_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_biz_created
  ON public.customer_orders(business_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_customer_orders_updated_at ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_updated_at
  BEFORE UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_orders_team_all ON public.customer_orders;
CREATE POLICY customer_orders_team_all ON public.customer_orders
  FOR ALL USING (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'customer_orders'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
  END IF;
END;
$$;`;

interface CustomerOrdersClientProps {
  tableMissing: boolean;
  businessName: string;
  initialOrders: CustomerOrder[];
}

export function CustomerOrdersClient({
  tableMissing,
  businessName,
  initialOrders,
}: CustomerOrdersClientProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<CustomerOrder[]>(initialOrders);
  const [filter, setFilter] = useState<"active" | "all" | "done">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerOrder | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  const counts = useMemo(() => {
    let unpaid = 0;
    let preparing = 0;
    let ready = 0;
    for (const o of orders) {
      if (o.payment_status === "pending") unpaid++;
      if (o.payment_status === "paid" && o.fulfillment_status === "preparing") preparing++;
      if (o.fulfillment_status === "ready") ready++;
    }
    return { unpaid, preparing, ready };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const isDone =
        o.fulfillment_status === "completed" ||
        o.fulfillment_status === "cancelled" ||
        o.payment_status === "rejected";
      if (filter === "active") return !isDone;
      if (filter === "done") return isDone;
      return true;
    });
  }, [orders, filter]);

  const handleCopyStoreLink = async () => {
    const url = `${window.location.origin}/pesan`;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopySql = async () => {
    await navigator.clipboard.writeText(CUSTOMER_ORDERS_MIGRATION_SQL);
    setCopiedSql(true);
    window.setTimeout(() => setCopiedSql(false), 2000);
  };

  const runAction = async (
    order: CustomerOrder,
    action: "confirm_paid" | "mark_ready" | "mark_completed" | "reject"
  ) => {
    setBusyId(order.id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/customer-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json?.order) {
        setErrorMsg(json?.error ?? "Gagal memproses validasi pesanan.");
        return;
      }

      const updated = json.order as CustomerOrder;
      setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));

      if (action === "confirm_paid") {
        setSuccessMsg(
          `Pembayaran ${updated.order_number} divalidasi lunas, masuk ke omzet & stok terpotong otomatis.`
        );
        void broadcastBusinessUpdate(updated.business_id, "orders");
      } else if (action === "mark_ready") {
        setSuccessMsg(`Pesanan ${updated.order_number} ditandai SUDAH JADI & siap diambil.`);
      } else if (action === "mark_completed") {
        setSuccessMsg(`Pesanan ${updated.order_number} ditandai SELESAI.`);
      } else {
        setSuccessMsg(`Pesanan ${updated.order_number} ditolak / dibatalkan.`);
        void broadcastBusinessUpdate(updated.business_id, "orders");
      }

      router.refresh();
    } catch {
      setErrorMsg("Gangguan jaringan saat memvalidasi pesanan.");
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/customer-orders/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json?.error ?? "Gagal menghapus pesanan.");
        return;
      }
      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      setSuccessMsg(`Pesanan ${deleteTarget.order_number} berhasil dihapus.`);
      setDeleteTarget(null);
      router.refresh();
    } catch {
      setErrorMsg("Gangguan jaringan saat menghapus pesanan.");
    } finally {
      setDeleting(false);
    }
  };

  const buildCustomerWaLink = (order: CustomerOrder) => {
    const wa = normalizeWhatsAppPhone(order.customer_phone);
    if (!wa) return null;
    const text =
      order.fulfillment_status === "ready"
        ? `Halo Kak ${order.customer_name}, pesanan ${order.order_number} (${order.quantity}x ${order.product_name}) di ${businessName || "Nummie"} SUDAH JADI dan siap diambil ya!`
        : order.payment_status === "paid"
          ? `Halo Kak ${order.customer_name}, pembayaran QRIS pesanan ${order.order_number} sudah kami terima dan sedang dibuat ya.`
          : `Halo Kak ${order.customer_name}, mengenai pesanan ${order.order_number} (${order.quantity}x ${order.product_name}) total ${formatRupiah(order.total_amount)}, bisa bantu kirim bukti bayar QRIS-nya?`;
    return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  };

  if (tableMissing) {
    return (
      <section className="glass-elevated max-w-3xl rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] text-[#92400E] flex items-center justify-center shrink-0">
            <Database size={24} weight="duotone" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              Aktifkan Tabel Pesanan Pembeli di Supabase
            </h2>
            <p className="text-xs sm:text-sm text-[#44403C]">
              Jalankan SQL migrasi satu kali di Supabase SQL Editor untuk mengaktifkan halaman pemesanan QRIS tanpa login (`/pesan`) dan fitur validasi pesanan di admin (`/pesanan`).
            </p>
          </div>
        </div>

        <pre className="rounded-xl bg-[#1C1917] text-[#FAFAF9] p-3.5 text-xs overflow-x-auto leading-relaxed max-h-72">
          <code>{CUSTOMER_ORDERS_MIGRATION_SQL}</code>
        </pre>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleCopySql}
            className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#166534] cursor-pointer"
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
            className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-[#1C1917] cursor-pointer"
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

      {/* Share Buyer Link & Counters */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-bold text-[#1C1917]">
            Link Halaman Pembeli (Tanpa Login)
          </p>
          <p className="text-xs text-[#44403C]">
            Bagikan tautan <code className="rounded bg-black/8 px-1.5 py-0.5 font-semibold">/pesan</code> ke bio Instagram atau WhatsApp pelanggan untuk pesan langsung via QRIS.
          </p>
          <div className="flex flex-wrap gap-2 pt-1.5">
            <button
              type="button"
              onClick={handleCopyStoreLink}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#166534] cursor-pointer"
            >
              {copiedLink ? (
                <Check size={15} weight="bold" aria-hidden="true" />
              ) : (
                <Copy size={15} weight="bold" aria-hidden="true" />
              )}
              <span>{copiedLink ? "Link Tersalin!" : "Salin Link Pembeli"}</span>
            </button>
            <Link
              href="/pesan"
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-black/5"
            >
              <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
              <span>Buka Halaman Pembeli</span>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 shrink-0 tabular-nums">
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold text-[#92400E]">Cek Bayar</p>
            <p className="text-lg font-extrabold text-[#92400E]">{counts.unpaid}</p>
          </div>
          <div className="rounded-xl bg-white border border-[#1C1917]/15 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold text-[#44403C]">Dibuat</p>
            <p className="text-lg font-extrabold text-[#1C1917]">{counts.preparing}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold text-[#14532D]">Siap Ambil</p>
            <p className="text-lg font-extrabold text-[#14532D]">{counts.ready}</p>
          </div>
        </div>
      </section>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "active", label: `Perlu Divalidasi / Diproses (${orders.filter((o) => o.fulfillment_status !== "completed" && o.fulfillment_status !== "cancelled" && o.payment_status !== "rejected").length})` },
            { key: "done", label: "Selesai / Ditolak" },
            { key: "all", label: `Semua (${orders.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`min-h-10 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              filter === tab.key
                ? "bg-[#14532D] text-white"
                : "glass-panel text-[#1C1917] hover:bg-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Belum ada pesanan di daftar ini"
          description="Pesanan QRIS yang dikirim pembeli lewat halaman /pesan akan muncul otomatis di sini secara real-time untuk Anda validasi."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const isBusy = busyId === order.id;
            const waLink = buildCustomerWaLink(order);

            return (
              <article
                key={order.id}
                className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm sm:text-base font-extrabold text-[#1C1917] tabular-nums">
                        {order.order_number}
                      </span>

                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          order.payment_status === "paid"
                            ? "bg-emerald-100 text-[#14532D]"
                            : order.payment_status === "rejected"
                              ? "bg-red-100 text-[#B91C1C]"
                              : "bg-amber-100 text-[#92400E]"
                        }`}
                      >
                        {order.payment_status === "paid"
                          ? "Sudah Bayar (QRIS)"
                          : order.payment_status === "rejected"
                            ? "Dibatalkan"
                            : "Belum Validasi Bayar"}
                      </span>

                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          order.fulfillment_status === "ready" ||
                          order.fulfillment_status === "completed"
                            ? "bg-[#14532D] text-white"
                            : order.fulfillment_status === "preparing"
                              ? "bg-[#B43D0A]/15 text-[#B43D0A]"
                              : "bg-black/8 text-[#44403C]"
                        }`}
                      >
                        {order.fulfillment_status === "completed"
                          ? "Selesai Diambil"
                          : order.fulfillment_status === "ready"
                            ? "Sudah Jadi"
                            : order.fulfillment_status === "preparing"
                              ? "Sedang Dibuat"
                              : order.fulfillment_status === "cancelled"
                                ? "Dibatalkan"
                                : "Menunggu Validasi"}
                      </span>
                    </div>

                    <p className="text-sm font-bold text-[#1C1917]">
                      {order.customer_name}{" "}
                      <span className="font-semibold text-[#44403C] tabular-nums">
                        ({order.customer_phone})
                      </span>
                    </p>

                    <p className="text-xs sm:text-sm text-[#1C1917]">
                      <ShoppingBag
                        size={14}
                        weight="bold"
                        className="inline mr-1 text-[#14532D]"
                        aria-hidden="true"
                      />
                      <strong>{order.quantity}x</strong> {order.product_name}
                    </p>

                    {order.notes ? (
                      <p className="text-xs text-[#44403C] bg-black/5 rounded-lg px-2.5 py-1.5 inline-block">
                        Catatan: {order.notes}
                      </p>
                    ) : null}

                    <p className="text-[11px] text-[#44403C]">
                      Masuk: {formatDateId(order.created_at, true)}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[11px] text-[#44403C]">Total QRIS</p>
                    <p className="text-xl font-extrabold text-[#14532D] tabular-nums">
                      {formatRupiah(order.total_amount)}
                    </p>
                  </div>
                </div>

                {/* Validation Action Buttons */}
                <div className="pt-3 border-t border-[#1C1917]/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {order.payment_status === "pending" ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runAction(order, "confirm_paid")}
                          className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
                        >
                          <CheckCircle size={16} weight="bold" aria-hidden="true" />
                          {isBusy ? "Memproses..." : "Validasi Sudah Bayar"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runAction(order, "reject")}
                          className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#B91C1C]/30 bg-white px-3 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-red-50 disabled:opacity-60 cursor-pointer"
                        >
                          <XCircle size={16} weight="bold" aria-hidden="true" />
                          Tolak
                        </button>
                      </>
                    ) : null}

                    {order.payment_status === "paid" &&
                    (order.fulfillment_status === "pending" ||
                      order.fulfillment_status === "preparing") ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runAction(order, "mark_ready")}
                        className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#B43D0A] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#9A3412] disabled:opacity-60 cursor-pointer"
                      >
                        <Package size={16} weight="bold" aria-hidden="true" />
                        {isBusy ? "Memproses..." : "Tandai Sudah Jadi"}
                      </button>
                    ) : null}

                    {order.fulfillment_status === "ready" ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runAction(order, "mark_completed")}
                        className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
                      >
                        <CheckCircle size={16} weight="bold" aria-hidden="true" />
                        {isBusy ? "Memproses..." : "Selesai / Sudah Diambil"}
                      </button>
                    ) : null}

                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-white px-3 py-2 text-xs font-bold text-[#14532D] hover:bg-emerald-50"
                      >
                        <WhatsappLogo size={16} weight="bold" aria-hidden="true" />
                        Chat WA Pembeli
                      </a>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDeleteTarget(order)}
                    aria-label={`Hapus pesanan ${order.order_number}`}
                    className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                  >
                    <Trash size={16} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Delete Confirm Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Hapus Pesanan ${deleteTarget?.order_number ?? ""}?`}
        description="Jika pesanan sudah divalidasi bayar, omzet dan stok bahan baku ikut dikembalikan otomatis."
      >
        <div className="space-y-4">
          <p className="text-sm text-[#1C1917]">
            Yakin menghapus pesanan atas nama{" "}
            <strong>{deleteTarget?.customer_name}</strong> senilai{" "}
            <strong className="tabular-nums">{formatRupiah(deleteTarget?.total_amount)}</strong>?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 text-sm font-semibold text-[#1C1917] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                void handleConfirmDelete();
              }}
              className="min-h-11 rounded-xl bg-[#B91C1C] px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60 cursor-pointer"
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

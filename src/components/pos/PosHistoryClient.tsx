"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle, Receipt, Storefront, Trash } from "@phosphor-icons/react";
import {
  formatDateId,
  formatRupiah,
  PAYMENT_METHOD_LABELS,
} from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { Order, StorePosConfig } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";
import { ReceiptModal } from "@/components/pos/ReceiptModal";

interface PosHistoryClientProps {
  isOwner: boolean;
  initialOrders: Order[];
  storeConfig: StorePosConfig;
}

export function PosHistoryClient({
  isOwner,
  initialOrders,
  storeConfig,
}: PosHistoryClientProps) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/orders/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? "Gagal menghapus transaksi.");
        return;
      }

      setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      void broadcastBusinessUpdate(storeConfig.business_id, "orders");
      setSuccessMsg(
        `Transaksi ${deleteTarget.order_number} dihapus. Stok bahan & kas shift sudah disesuaikan otomatis.`
      );
      setDeleteTarget(null);
    } catch {
      setErrorMsg("Gangguan jaringan saat menghapus transaksi.");
    } finally {
      setDeleting(false);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="space-y-4 max-w-4xl">
        {successMsg ? (
          <div
            role="status"
            className="rounded-2xl border border-[#14532D]/30 bg-emerald-50/90 px-4 py-3 text-sm text-[#1C1917] flex items-center gap-2.5"
          >
            <CheckCircle size={20} weight="bold" className="text-[#14532D]" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        ) : null}
        <EmptyState
          title="Belum ada transaksi di shift ini"
          description="Transaksi yang Anda selesaikan di layar Kasir POS akan muncul di sini beserta tombol cetak ulang, kirim struk WhatsApp, dan hapus transaksi."
          action={
            <Link
              href="/pos"
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-sm font-bold text-white"
            >
              <Storefront size={18} weight="bold" aria-hidden="true" />
              Buka Layar Kasir
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-4xl">
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

      {orders.map((order) => (
        <article
          key={order.id}
          className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-extrabold text-[#1C1917] tabular-nums">
                {order.order_number}
              </span>
              <span className="rounded-lg bg-[#14532D]/12 text-[#14532D] px-2 py-0.5 text-xs font-bold">
                {PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}
              </span>
              {order.notes ? (
                <span className="rounded-lg bg-[#B43D0A]/12 text-[#B43D0A] px-2 py-0.5 text-xs font-bold">
                  {order.notes}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-[#44403C]">
              {formatDateId(order.created_at, true)}
              {order.customer_phone ? ` · WA: ${order.customer_phone}` : ""}
            </p>
            <p className="text-xs text-[#1C1917] truncate">
              {(order.items ?? [])
                .map((i) => `${i.product_name} x${i.quantity}`)
                .join(", ")}
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <p className="text-base sm:text-lg font-extrabold text-[#14532D] tabular-nums">
              {formatRupiah(order.total_amount)}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/85 px-3 py-1.5 text-xs font-bold text-[#1C1917] hover:bg-white"
              >
                <Receipt size={15} weight="duotone" aria-hidden="true" />
                Struk
              </button>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(order)}
                  aria-label={`Hapus transaksi ${order.order_number}`}
                  className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 bg-white/85 inline-flex items-center justify-center text-[#B91C1C] hover:bg-red-50"
                >
                  <Trash size={16} weight="bold" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}

      <ReceiptModal
        order={selectedOrder}
        store={storeConfig}
        onClose={() => setSelectedOrder(null)}
      />

      {/* Modal Konfirmasi Hapus Transaksi */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Hapus Transaksi ${deleteTarget?.order_number ?? ""}?`}
        description="Tindakan ini tidak dapat dibatalkan."
      >
        <div className="space-y-4">
          <p className="text-sm text-[#1C1917] leading-relaxed">
            Menghapus transaksi senilai{" "}
            <strong className="tabular-nums">
              {formatRupiah(deleteTarget?.total_amount)}
            </strong>{" "}
            akan otomatis mengembalikan stok bahan baku yang sempat terpakai dan menyesuaikan
            nominal kas shift terkait.
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
              {deleting ? "Menghapus..." : "Ya, Hapus Transaksi"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

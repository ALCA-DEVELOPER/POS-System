"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowsOutSimple,
  CheckCircle,
  Clock,
  DownloadSimple,
  MapPin,
  Minus,
  Package,
  Plus,
  QrCode,
  SignIn,
  Storefront,
  WarningCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { formatDateId, formatRupiah, normalizeWhatsAppPhone } from "@/lib/format";
import { getPublicOrderChannelName } from "@/lib/realtime";
import type { CustomerOrder, PublicStorefrontData } from "@/types/database";

const LAST_ORDER_STORAGE_KEY = "nummie_last_customer_order_id";

interface CustomerOrderClientProps {
  storefront: PublicStorefrontData | null;
  initialTrackedOrder: CustomerOrder | null;
}

type TrackedOrderView = Pick<
  CustomerOrder,
  | "id"
  | "order_number"
  | "customer_name"
  | "customer_phone"
  | "product_name"
  | "quantity"
  | "unit_price"
  | "total_amount"
  | "payment_status"
  | "fulfillment_status"
  | "notes"
  | "paid_verified_at"
  | "ready_at"
  | "created_at"
>;

export function CustomerOrderClient({
  storefront,
  initialTrackedOrder,
}: CustomerOrderClientProps) {
  const [trackedOrder, setTrackedOrder] = useState<TrackedOrderView | null>(
    initialTrackedOrder
  );
  const [payTab, setPayTab] = useState<"qris" | "cash_chat">("qris");
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrisFullscreen, setQrisFullscreen] = useState(false);

  const product = storefront?.product ?? null;
  const totalAmount = useMemo(() => {
    if (!product) return 0;
    return Number(product.price) * quantity;
  }, [product, quantity]);

  const storeWaNumber = useMemo(
    () => normalizeWhatsAppPhone(storefront?.phone ?? ""),
    [storefront?.phone]
  );

  // Pulihkan pesanan terakhir pembeli dari browser jika kembali tanpa parameter query
  useEffect(() => {
    if (trackedOrder || typeof window === "undefined") return;
    const savedId = window.localStorage.getItem(LAST_ORDER_STORAGE_KEY);
    if (!savedId) return;

    let cancelled = false;
    fetch(`/api/public/orders/${encodeURIComponent(savedId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.order) {
          setTrackedOrder(json.order as TrackedOrderView);
        } else if (!cancelled && json === null) {
          window.localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
        }
      })
      .catch(() => {
        // Biarkan tetap menampilkan form pemesanan
      });

    return () => {
      cancelled = true;
    };
  }, [trackedOrder]);

  // Pantau status validasi pembayaran & penyiapan pesanan secara real-time
  useEffect(() => {
    if (!trackedOrder?.id) return;
    const orderId = trackedOrder.id;
    let cancelled = false;

    const fetchLatest = async () => {
      try {
        const res = await fetch(`/api/public/orders/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled && json?.order) {
          setTrackedOrder(json.order as TrackedOrderView);
        }
      } catch {
        // Abaikan error jaringan sementara saat polling
      }
    };

    const supabase = createClient();
    const channel = supabase
      .channel(getPublicOrderChannelName(orderId))
      .on("broadcast", { event: "order_update" }, () => {
        void fetchLatest();
      })
      .subscribe();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchLatest();
      }
    }, 5000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchLatest();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [trackedOrder?.id]);

  // Tutup mode layar penuh QRIS dengan tombol Escape
  useEffect(() => {
    if (!qrisFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrisFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [qrisFullscreen]);

  const handleSubmitQrisOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: customerPhone,
          quantity,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.order) {
        setErrorMsg(json?.error ?? "Gagal mengirim pesanan. Coba lagi.");
        return;
      }

      const created = json.order as TrackedOrderView;
      setTrackedOrder(created);
      setQrisFullscreen(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_ORDER_STORAGE_KEY, created.id);
        window.history.replaceState(null, "", `/pesan?order=${created.id}`);
      }
    } catch {
      setErrorMsg("Gangguan jaringan saat mengirim pesanan.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetNewOrder = () => {
    setTrackedOrder(null);
    setQuantity(1);
    setNotes("");
    setErrorMsg(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
      window.history.replaceState(null, "", "/pesan");
    }
  };

  const buildCashChatUrl = () => {
    const nama = customerName.trim() || "Pembeli";
    const hp = customerPhone.trim() ? ` (${customerPhone.trim()})` : "";
    const catatan = notes.trim() ? `\nCatatan: ${notes.trim()}` : "";
    const msg = [
      `Halo Kak ${storefront?.businessName || "Nummie"}, saya ${nama}${hp}.`,
      `Saya mau pesan:`,
      `- ${quantity}x ${product?.name || "Paket Lumpia Ubi Ungu (coklat & keju)"} (${formatRupiah(totalAmount)})`,
      `Metode bayar: TUNAI (chat konfirmasi).${catatan}`,
    ].join("\n");
    return `https://wa.me/${storeWaNumber}?text=${encodeURIComponent(msg)}`;
  };

  const buildProofChatUrl = (order: TrackedOrderView) => {
    const msg = [
      `Halo Kak ${storefront?.businessName || "Nummie"}, saya ${order.customer_name} sudah pesan via web.`,
      `Kode Pesanan: *${order.order_number}*`,
      `Pesanan: ${order.quantity}x ${order.product_name}`,
      `Total QRIS: ${formatRupiah(order.total_amount)}`,
      `Berikut saya konfirmasi pembayarannya ya Kak.`,
    ].join("\n");
    return `https://wa.me/${storeWaNumber}?text=${encodeURIComponent(msg)}`;
  };

  if (!storefront || !product) {
    return (
      <main id="main-content" className="min-h-dvh px-4 py-10 flex items-center justify-center">
        <div className="glass-elevated max-w-md w-full rounded-2xl p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#14532D]/10 text-[#14532D] flex items-center justify-center">
            <Storefront size={26} weight="duotone" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-extrabold text-[#1C1917]">
            Toko Sedang Disiapkan
          </h1>
          <p className="text-sm text-[#44403C]">
            Menu pemesanan online belum aktif saat ini. Silakan kembali sebentar lagi atau masuk sebagai admin.
          </p>
          <Link
            href="/login"
            className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-5 py-2.5 text-sm font-bold text-white"
          >
            <SignIn size={18} weight="bold" aria-hidden="true" />
            Masuk Admin
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top Storefront Bar */}
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="glass-elevated max-w-2xl mx-auto rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#14532D] text-white flex items-center justify-center font-extrabold text-sm shrink-0 overflow-hidden">
              {storefront.logoUrl ? (
                <Image
                  src={storefront.logoUrl}
                  alt={storefront.businessName}
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                storefront.businessName.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm sm:text-base font-extrabold text-[#1C1917] truncate">
                {storefront.businessName}
              </p>
              {storefront.address ? (
                <p className="text-[11px] sm:text-xs text-[#44403C] flex items-center gap-1 truncate">
                  <MapPin size={12} weight="bold" className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{storefront.address}</span>
                </p>
              ) : null}
            </div>
          </div>

          <Link
            href="/login"
            className="min-h-10 shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/85 px-3 text-xs font-semibold text-[#1C1917] hover:bg-white transition-colors"
          >
            <SignIn size={15} weight="bold" aria-hidden="true" />
            <span>Admin</span>
          </Link>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-3 py-5 sm:px-6 max-w-2xl w-full mx-auto space-y-5">
        {trackedOrder ? (
          <section className="glass-elevated rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#14532D]">
                  Status Pesanan Anda
                </p>
                <h1 className="text-xl sm:text-2xl font-extrabold text-[#1C1917] tabular-nums">
                  {trackedOrder.order_number}
                </h1>
                <p className="text-xs text-[#44403C] mt-0.5">
                  Atas nama <strong className="text-[#1C1917]">{trackedOrder.customer_name}</strong>{" "}
                  · {formatDateId(trackedOrder.created_at, true)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold shrink-0 ${
                  trackedOrder.payment_status === "paid"
                    ? "bg-emerald-100 text-[#14532D]"
                    : trackedOrder.payment_status === "rejected"
                      ? "bg-red-100 text-[#B91C1C]"
                      : "bg-amber-100 text-[#92400E]"
                }`}
              >
                {trackedOrder.payment_status === "paid"
                  ? "Pembayaran Valid"
                  : trackedOrder.payment_status === "rejected"
                    ? "Dibatalkan"
                    : "Cek Pembayaran"}
              </span>
            </div>

            {/* Order Details Summary */}
            <div className="rounded-xl bg-white/80 border border-[#1C1917]/10 p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#1C1917]">
                  {trackedOrder.quantity}x {trackedOrder.product_name}
                </p>
                {trackedOrder.notes ? (
                  <p className="text-xs text-[#44403C] mt-0.5">
                    Catatan: {trackedOrder.notes}
                  </p>
                ) : null}
              </div>
              <p className="text-lg font-extrabold text-[#14532D] tabular-nums shrink-0">
                {formatRupiah(trackedOrder.total_amount)}
              </p>
            </div>

            {/* Live Progress Steps */}
            <div className="space-y-3">
              <div className="rounded-xl border border-[#14532D]/20 bg-emerald-50/70 p-3.5 flex items-start gap-3">
                <CheckCircle
                  size={20}
                  weight="fill"
                  className="text-[#14532D] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-bold text-[#1C1917]">1. Pesanan Diterima Sistem</p>
                  <p className="text-xs text-[#44403C]">
                    Pesanan Anda sudah masuk ke antrean kasir {storefront.businessName}.
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border p-3.5 flex items-start gap-3 ${
                  trackedOrder.payment_status === "paid"
                    ? "border-[#14532D]/20 bg-emerald-50/70"
                    : trackedOrder.payment_status === "rejected"
                      ? "border-[#B91C1C]/30 bg-red-50"
                      : "border-[#92400E]/20 bg-amber-50/80"
                }`}
              >
                {trackedOrder.payment_status === "paid" ? (
                  <CheckCircle
                    size={20}
                    weight="fill"
                    className="text-[#14532D] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : trackedOrder.payment_status === "rejected" ? (
                  <WarningCircle
                    size={20}
                    weight="fill"
                    className="text-[#B91C1C] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : (
                  <Clock
                    size={20}
                    weight="duotone"
                    className="text-[#92400E] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="text-sm font-bold text-[#1C1917]">
                    2. Validasi Pembayaran QRIS
                  </p>
                  <p className="text-xs text-[#44403C]">
                    {trackedOrder.payment_status === "paid"
                      ? "Pembayaran QRIS Anda sudah dikonfirmasi oleh admin."
                      : trackedOrder.payment_status === "rejected"
                        ? "Pembayaran belum terverifikasi atau dibatalkan admin. Silakan hubungi WhatsApp toko."
                        : "Admin sedang memeriksa pembayaran QRIS Anda. Halaman ini terupdate otomatis."}
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border p-3.5 flex items-start gap-3 ${
                  trackedOrder.fulfillment_status === "ready" ||
                  trackedOrder.fulfillment_status === "completed"
                    ? "border-[#14532D]/30 bg-emerald-50"
                    : "border-[#1C1917]/10 bg-white/75"
                }`}
              >
                {trackedOrder.fulfillment_status === "ready" ||
                trackedOrder.fulfillment_status === "completed" ? (
                  <CheckCircle
                    size={20}
                    weight="fill"
                    className="text-[#14532D] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : (
                  <Package
                    size={20}
                    weight="duotone"
                    className="text-[#44403C] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="text-sm font-bold text-[#1C1917]">
                    3. Status Pembuatan Pesanan
                  </p>
                  <p className="text-xs text-[#44403C]">
                    {trackedOrder.fulfillment_status === "completed"
                      ? "Pesanan selesai dan sudah diambil. Terima kasih sudah berbelanja!"
                      : trackedOrder.fulfillment_status === "ready"
                        ? "Pesanan Anda SUDAH JADI & siap diambil sekarang!"
                        : trackedOrder.fulfillment_status === "preparing"
                          ? "Pesanan Anda sedang dibuat oleh tim dapur."
                          : trackedOrder.fulfillment_status === "cancelled"
                            ? "Pesanan dibatalkan."
                            : "Menunggu konfirmasi pembayaran untuk mulai dibuat."}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              {storeWaNumber ? (
                <a
                  href={buildProofChatUrl(trackedOrder)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-11 flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
                >
                  <WhatsappLogo size={18} weight="bold" aria-hidden="true" />
                  Kirim Bukti / Chat Penjual
                </a>
              ) : null}
              <button
                type="button"
                onClick={handleResetNewOrder}
                className="min-h-11 flex-1 rounded-xl border border-[#1C1917]/20 bg-white px-4 py-2.5 text-sm font-semibold text-[#1C1917] hover:bg-black/5 transition-colors cursor-pointer"
              >
                Pesan Lagi
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={handleSubmitQrisOrder} className="space-y-5">
            {/* Flagship Single Product Card */}
            <section className="glass-elevated rounded-2xl overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-12">
                <div className="sm:col-span-5 relative aspect-[4/3] sm:aspect-auto sm:min-h-[220px] bg-white">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      fill
                      priority
                      sizes="(max-width: 640px) 100vw, 280px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl font-extrabold text-[#14532D]">
                      LU
                    </div>
                  )}
                </div>

                <div className="sm:col-span-7 p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    <span className="inline-block rounded-full bg-[#14532D]/10 px-2.5 py-0.5 text-xs font-bold text-[#14532D]">
                      {product.category}
                    </span>
                    <h1 className="text-lg sm:text-xl font-extrabold text-[#1C1917] leading-snug">
                      {product.name}
                    </h1>
                    <p className="text-2xl font-extrabold text-[#14532D] tabular-nums">
                      {formatRupiah(product.price)}
                      <span className="text-xs font-medium text-[#44403C]"> / paket</span>
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#1C1917]/10">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#44403C]">Jumlah:</span>
                      <div className="inline-flex items-center gap-1.5 rounded-xl bg-black/5 p-1">
                        <button
                          type="button"
                          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                          aria-label="Kurangi jumlah"
                          className="w-9 h-9 rounded-lg bg-white border border-[#1C1917]/15 inline-flex items-center justify-center text-[#1C1917] cursor-pointer"
                        >
                          <Minus size={16} weight="bold" aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-sm font-extrabold text-[#1C1917] tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity((q) => Math.min(100, q + 1))}
                          aria-label="Tambah jumlah"
                          className="w-9 h-9 rounded-lg bg-[#14532D] text-white inline-flex items-center justify-center cursor-pointer"
                        >
                          <Plus size={16} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-[11px] text-[#44403C]">Total Bayar</span>
                      <span className="text-lg font-extrabold text-[#B43D0A] tabular-nums">
                        {formatRupiah(totalAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Buyer Info Card */}
            <section className="glass-panel rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-[#1C1917]">Data Pemesan</h2>

              {errorMsg ? (
                <div
                  role="alert"
                  className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3.5 py-2.5 text-xs text-[#B91C1C] flex items-center gap-2"
                >
                  <WarningCircle size={16} weight="bold" aria-hidden="true" />
                  <span>{errorMsg}</span>
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="buyerName" className="block text-xs font-semibold text-[#1C1917]">
                    Nama Lengkap
                  </label>
                  <input
                    id="buyerName"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Contoh: Budi"
                    className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="buyerPhone" className="block text-xs font-semibold text-[#1C1917]">
                    No. HP / WhatsApp
                  </label>
                  <input
                    id="buyerPhone"
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0812xxxxxxxx"
                    className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917] tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="buyerNotes" className="block text-xs font-semibold text-[#1C1917]">
                  Catatan Tambahan (Opsional)
                </label>
                <input
                  id="buyerNotes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Diambil jam 16.00 / cokelat lebih banyak"
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                />
              </div>
            </section>

            {/* Payment Method Section */}
            <section className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#1C1917]">Metode Pembayaran</h2>
                <p className="text-xs text-[#44403C]">
                  Pemesanan langsung lewat web menggunakan QRIS. Untuk pembayaran tunai dapat memesan langsung lewat chat WhatsApp.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayTab("qris")}
                  className={`min-h-11 rounded-xl border px-3 py-2 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                    payTab === "qris"
                      ? "border-[#14532D] bg-[#14532D] text-white"
                      : "border-[#1C1917]/20 bg-white text-[#1C1917]"
                  }`}
                >
                  <QrCode size={18} weight="bold" aria-hidden="true" />
                  <span>Bayar QRIS</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPayTab("cash_chat")}
                  className={`min-h-11 rounded-xl border px-3 py-2 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                    payTab === "cash_chat"
                      ? "border-[#B43D0A] bg-[#B43D0A] text-white"
                      : "border-[#1C1917]/20 bg-white text-[#1C1917]"
                  }`}
                >
                  <WhatsappLogo size={18} weight="bold" aria-hidden="true" />
                  <span>Tunai (Chat WA)</span>
                </button>
              </div>

              {payTab === "qris" ? (
                <div className="space-y-4">
                  <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 text-center space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-[#44403C]">
                        Silakan scan atau simpan QRIS untuk total:
                      </p>
                      <p className="text-2xl font-extrabold text-[#14532D] tabular-nums">
                        {formatRupiah(totalAmount)}
                      </p>
                    </div>

                    {storefront.qrisImageUrl ? (
                      <div className="space-y-2.5">
                        <div className="mx-auto w-56 h-56 relative">
                          <Image
                            src={storefront.qrisImageUrl}
                            alt={`QRIS ${storefront.businessName}`}
                            fill
                            sizes="224px"
                            className="object-contain rounded-xl"
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQrisFullscreen(true)}
                            className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-[#14532D]/10 px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-[#14532D]/15 cursor-pointer"
                          >
                            <ArrowsOutSimple size={15} weight="bold" aria-hidden="true" />
                            Perbesar QRIS
                          </button>
                          <a
                            href={storefront.qrisImageUrl}
                            download={`QRIS-${storefront.businessName}.jpg`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-black/5"
                          >
                            <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                            Simpan Gambar QRIS
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#B43D0A] bg-[#FEF3C7] rounded-xl p-3">
                        Gambar QRIS toko belum diunggah oleh admin.
                      </p>
                    )}

                    <p className="text-xs text-[#44403C] leading-relaxed">
                      Setelah berhasil transfer via QRIS, tekan tombol konfirmasi di bawah agar admin memvalidasi pembayaran dan menyiapkan pesanan Anda.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !storefront.qrisImageUrl}
                    className="min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {submitting
                      ? "Mengirim pesanan..."
                      : `Konfirmasi Sudah Bayar (${formatRupiah(totalAmount)})`}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 space-y-3">
                  <p className="text-sm font-bold text-[#1C1917]">
                    Pemesanan Tunai Dilayani via Chat WhatsApp
                  </p>
                  <p className="text-xs text-[#44403C] leading-relaxed">
                    Untuk menjaga ketersediaan stok, pesanan dengan pembayaran tunai tidak diproses lewat form web. Klik tombol di bawah untuk langsung chat admin dengan detail pesanan Anda.
                  </p>
                  {storeWaNumber ? (
                    <a
                      href={buildCashChatUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#9A3412] transition-colors"
                    >
                      <WhatsappLogo size={20} weight="bold" aria-hidden="true" />
                      Pesan Tunai via WhatsApp ({formatRupiah(totalAmount)})
                    </a>
                  ) : (
                    <p className="text-xs text-[#B43D0A]">
                      Nomor WhatsApp toko belum diatur oleh admin.
                    </p>
                  )}
                </div>
              )}
            </section>
          </form>
        )}
      </main>

      {qrisFullscreen && storefront.qrisImageUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tampilan QRIS Layar Penuh"
          style={{ zIndex: 60 }}
          className="fixed inset-0 bg-white flex flex-col justify-between p-4 sm:p-6 overflow-y-auto"
        >
          <div className="max-w-lg w-full mx-auto flex items-center justify-between gap-3">
            <div>
              <p className="text-base sm:text-lg font-extrabold text-[#1C1917]">
                {storefront.businessName}
              </p>
              <p className="text-xs sm:text-sm text-[#44403C]">
                Scan atau screenshot QRIS untuk pembayaran
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQrisFullscreen(false)}
              aria-label="Tutup tampilan layar penuh QRIS"
              className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-black/5 cursor-pointer"
            >
              <X size={16} weight="bold" aria-hidden="true" />
              <span>Tutup</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center py-4 gap-3 max-w-lg w-full mx-auto">
            <div className="text-center space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-[#44403C]">Total Pembayaran</p>
              <p className="text-3xl sm:text-4xl font-extrabold text-[#14532D] tabular-nums tracking-tight">
                {formatRupiah(totalAmount)}
              </p>
            </div>

            <div
              style={{
                width: "min(84vw, 58dvh, 440px)",
                height: "min(84vw, 58dvh, 440px)",
              }}
              className="rounded-2xl border-2 border-[#1C1917]/15 bg-white p-3 shadow-sm"
            >
              <div className="relative w-full h-full">
                <Image
                  src={storefront.qrisImageUrl}
                  alt={`QRIS ${storefront.businessName}`}
                  fill
                  sizes="(max-width: 640px) 84vw, 440px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>

          <div className="max-w-lg w-full mx-auto">
            <button
              type="button"
              onClick={() => setQrisFullscreen(false)}
              className="min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#166534] cursor-pointer"
            >
              Kembali ke Halaman Pemesanan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

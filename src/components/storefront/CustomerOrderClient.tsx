"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowsOutSimple,
  Bank,
  Check,
  CheckCircle,
  Clock,
  Copy,
  DownloadSimple,
  MapPin,
  Megaphone,
  Minus,
  Package,
  Plus,
  QrCode,
  Storefront,
  Truck,
  Wallet,
  WarningCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { formatDateId, formatRupiah, normalizeWhatsAppPhone } from "@/lib/format";
import { getPublicOrderChannelName } from "@/lib/realtime";
import {
  getCustomerPaymentMethodLabel,
  resolveCustomerOrderDelivery,
  resolveCustomerOrderPaymentMethod,
} from "@/lib/customer-order-payment";
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
  | "payment_method"
  | "payment_status"
  | "fulfillment_status"
  | "delivery_type"
  | "delivery_fee"
  | "delivery_address"
  | "notes"
  | "paid_verified_at"
  | "ready_at"
  | "created_at"
>;

function PaymentAmountBreakdown({
  title,
  quantity,
  productSubtotal,
  deliveryFee,
  totalAmount,
}: {
  title: string;
  quantity: number;
  productSubtotal: number;
  deliveryFee: number;
  totalAmount: number;
}) {
  return (
    <div className="space-y-1 text-center">
      <p className="text-xs font-semibold text-[#44403C]">{title}</p>
      {deliveryFee > 0 ? (
        <p className="text-[11px] text-[#44403C] tabular-nums">
          Menu ({quantity}x): {formatRupiah(productSubtotal)} + Ongkir:{" "}
          {formatRupiah(deliveryFee)}
        </p>
      ) : null}
      <p className="text-2xl font-extrabold text-[#14532D] tabular-nums">
        {formatRupiah(totalAmount)}
      </p>
    </div>
  );
}

export function CustomerOrderClient({
  storefront,
  initialTrackedOrder,
}: CustomerOrderClientProps) {
  const router = useRouter();
  const settings = storefront?.settings;
  const qrisEnabled = settings?.enable_qris !== false;
  const transferEnabled = settings?.enable_transfer !== false;
  const directEnabled = qrisEnabled || transferEnabled;
  const onsiteEnabled = settings?.enable_cash_chat !== false;
  const pickupEnabled = settings?.enable_pickup !== false;
  const deliveryEnabled = settings?.enable_delivery !== false;
  const configuredDeliveryFee = Math.max(0, Number(settings?.delivery_fee ?? 1500));

  const [trackedOrder, setTrackedOrder] = useState<TrackedOrderView | null>(
    initialTrackedOrder
  );
  const [payMode, setPayMode] = useState<"direct" | "onsite">(
    directEnabled ? "direct" : "onsite"
  );
  const [directMethod, setDirectMethod] = useState<"qris" | "transfer">(
    qrisEnabled ? "qris" : "transfer"
  );
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">(
    pickupEnabled ? "pickup" : "delivery"
  );
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrisFullscreen, setQrisFullscreen] = useState(false);
  const [copiedRek, setCopiedRek] = useState(false);

  const product = storefront?.product ?? null;
  const productSubtotal = useMemo(() => {
    if (!product) return 0;
    return Number(product.price) * quantity;
  }, [product, quantity]);
  const activeDeliveryFee =
    deliveryType === "delivery" && deliveryEnabled ? configuredDeliveryFee : 0;
  const totalAmount = productSubtotal + activeDeliveryFee;

  const storeWaNumber = useMemo(
    () => normalizeWhatsAppPhone(storefront?.phone ?? ""),
    [storefront?.phone]
  );

  // Sinkronkan mode pembayaran & pengiriman bila pengaturan toko diperbarui secara real-time
  useEffect(() => {
    if (!settings) return;
    if (!directEnabled && onsiteEnabled && payMode === "direct") {
      setPayMode("onsite");
    } else if (directEnabled && !onsiteEnabled && payMode === "onsite") {
      setPayMode("direct");
    }

    if (!qrisEnabled && transferEnabled && directMethod === "qris") {
      setDirectMethod("transfer");
    } else if (qrisEnabled && !transferEnabled && directMethod === "transfer") {
      setDirectMethod("qris");
    }

    if (!pickupEnabled && deliveryEnabled && deliveryType === "pickup") {
      setDeliveryType("delivery");
    } else if (pickupEnabled && !deliveryEnabled && deliveryType === "delivery") {
      setDeliveryType("pickup");
    }
  }, [
    settings,
    directEnabled,
    onsiteEnabled,
    qrisEnabled,
    transferEnabled,
    pickupEnabled,
    deliveryEnabled,
    payMode,
    directMethod,
    deliveryType,
  ]);

  // Dengarkan pembaruan poster/pengaturan storefront secara real-time dari admin
  useEffect(() => {
    const bizId = storefront?.businessId;
    if (!bizId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`kulinerkas-storefront-${bizId}`)
      .on("broadcast", { event: "storefront_update" }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [storefront?.businessId, router]);

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
        if (res.status === 404 && !cancelled) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
            window.history.replaceState(null, "", "/pesan");
          }
          setTrackedOrder(null);
          return;
        }
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

  const handleSubmitDirectOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;

    if (deliveryType === "delivery" && deliveryAddress.trim().length < 5) {
      setErrorMsg("Mohon isi alamat kos lengkap untuk pengantaran.");
      return;
    }

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
          payment_method: directMethod,
          delivery_type: deliveryType,
          delivery_address: deliveryType === "delivery" ? deliveryAddress.trim() : "",
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

  const handleCopyAccountNumber = async () => {
    const account = storefront?.bankAccountNumber?.trim();
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopiedRek(true);
      window.setTimeout(() => setCopiedRek(false), 2000);
    } catch {
      // Abaikan jika browser memblokir clipboard
    }
  };

  const handleResetNewOrder = () => {
    setTrackedOrder(null);
    setQuantity(1);
    setDeliveryAddress("");
    setErrorMsg(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
      window.history.replaceState(null, "", "/pesan");
    }
  };

  const buildOnsiteChatUrl = () => {
    const nama = customerName.trim() || "Pembeli";
    const hp = customerPhone.trim() ? ` (${customerPhone.trim()})` : "";
    const deliveryLine =
      deliveryType === "delivery"
        ? `Pengambilan: Diantar ke Kos (+${formatRupiah(activeDeliveryFee)})\nAlamat Kos: ${deliveryAddress.trim() || "-"}`
        : `Pengambilan: Ambil / COD di lokasi (${settings?.pickup_info || "Telkom University Purwokerto"})`;
    const msg = [
      `Halo Kak ${storefront?.businessName || "Nummie"}, saya ${nama}${hp}.`,
      `Saya mau pesan Onsite:`,
      `- ${quantity}x ${product?.name || "Paket Lumpia Ubi Ungu (coklat & keju)"} (${formatRupiah(productSubtotal)})`,
      deliveryLine,
      `Total: ${formatRupiah(totalAmount)}`,
      `Metode bayar: ONSITE / BAYAR DI TEMPAT (konfirmasi WhatsApp).`,
    ].join("\n");
    return `https://wa.me/${storeWaNumber}?text=${encodeURIComponent(msg)}`;
  };

  const buildProofChatUrl = (order: TrackedOrderView) => {
    const methodLabel = getCustomerPaymentMethodLabel(
      resolveCustomerOrderPaymentMethod(order)
    );
    const delivery = resolveCustomerOrderDelivery(order);
    const deliveryLine =
      delivery.delivery_type === "delivery"
        ? `Pengambilan: Diantar ke Kos (${delivery.delivery_address || "-"})`
        : `Pengambilan: Ambil / COD di lokasi`;
    const msg = [
      `Halo Kak ${storefront?.businessName || "Nummie"}, saya ${order.customer_name} sudah pesan via web.`,
      `Kode Pesanan: *${order.order_number}*`,
      `Pesanan: ${order.quantity}x ${order.product_name}`,
      deliveryLine,
      `Total (${methodLabel}): ${formatRupiah(order.total_amount)}`,
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
            Menu pemesanan online belum aktif saat ini. Silakan kembali sebentar lagi ya.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top Storefront Bar */}
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="glass-elevated max-w-2xl mx-auto rounded-2xl px-4 py-3 flex items-center gap-3">
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
            {(() => {
              const trackedDelivery = resolveCustomerOrderDelivery(trackedOrder);
              const menuSubtotal =
                Number(trackedOrder.unit_price) * Number(trackedOrder.quantity);
              return (
                <div className="rounded-xl bg-white/85 border border-[#1C1917]/10 p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-[#1C1917]">
                        {trackedOrder.quantity}x {trackedOrder.product_name}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          trackedDelivery.delivery_type === "delivery"
                            ? "bg-[#B43D0A]/15 text-[#B43D0A]"
                            : "bg-[#14532D]/10 text-[#14532D]"
                        }`}
                      >
                        {trackedDelivery.delivery_type === "delivery" ? (
                          <>
                            <Truck size={12} weight="bold" aria-hidden="true" />
                            <span>
                              Diantar ke Kos (+{formatRupiah(trackedDelivery.delivery_fee)})
                            </span>
                          </>
                        ) : (
                          <>
                            <MapPin size={12} weight="bold" aria-hidden="true" />
                            <span>Ambil / COD di Lokasi</span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-extrabold text-[#14532D] tabular-nums">
                        {formatRupiah(trackedOrder.total_amount)}
                      </p>
                      {trackedDelivery.delivery_type === "delivery" ? (
                        <p className="text-[11px] text-[#44403C] tabular-nums">
                          Menu {formatRupiah(menuSubtotal)} + Ongkir{" "}
                          {formatRupiah(trackedDelivery.delivery_fee)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {trackedDelivery.delivery_type === "delivery" &&
                  trackedDelivery.delivery_address ? (
                    <p className="text-xs text-[#1C1917] bg-black/[0.04] rounded-lg px-3 py-2">
                      <strong>Alamat Kos:</strong> {trackedDelivery.delivery_address}
                    </p>
                  ) : null}

                  {trackedDelivery.delivery_type === "pickup" && settings?.pickup_info ? (
                    <p className="text-xs text-[#44403C] bg-emerald-50/75 border border-[#14532D]/15 rounded-lg px-3 py-2">
                      <strong>Jadwal Ambil / COD:</strong> {settings.pickup_info}
                    </p>
                  ) : null}
                </div>
              );
            })()}

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
                    2. Validasi Pembayaran{" "}
                    {getCustomerPaymentMethodLabel(
                      resolveCustomerOrderPaymentMethod(trackedOrder)
                    )}
                  </p>
                  <p className="text-xs text-[#44403C]">
                    {trackedOrder.payment_status === "paid"
                      ? `Pembayaran ${getCustomerPaymentMethodLabel(
                          resolveCustomerOrderPaymentMethod(trackedOrder)
                        )} Anda sudah dikonfirmasi oleh penjual.`
                      : trackedOrder.payment_status === "rejected"
                        ? "Pembayaran belum terverifikasi atau dibatalkan penjual. Silakan hubungi WhatsApp toko."
                        : `Penjual sedang memeriksa pembayaran ${getCustomerPaymentMethodLabel(
                            resolveCustomerOrderPaymentMethod(trackedOrder)
                          )} Anda. Halaman ini terupdate otomatis.`}
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border p-3.5 flex items-start gap-3 ${
                  trackedOrder.fulfillment_status === "ready" ||
                  trackedOrder.fulfillment_status === "shipping" ||
                  trackedOrder.fulfillment_status === "completed"
                    ? "border-[#14532D]/30 bg-emerald-50"
                    : "border-[#1C1917]/10 bg-white/75"
                }`}
              >
                {trackedOrder.fulfillment_status === "shipping" ? (
                  <Truck
                    size={20}
                    weight="fill"
                    className="text-[#14532D] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : trackedOrder.fulfillment_status === "ready" ||
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
                      ? "Pesanan selesai dan sudah diterima. Terima kasih sudah berbelanja!"
                      : trackedOrder.fulfillment_status === "shipping"
                        ? "Pesanan Anda sedang dalam perjalanan diantar ke alamat kos Anda!"
                        : trackedOrder.fulfillment_status === "ready"
                          ? "Pesanan Anda sudah jadi."
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
          <div className="space-y-5">
            {settings?.announcement ? (
              <div className="glass-panel rounded-2xl px-4 py-3 flex items-start gap-2.5 border border-[#14532D]/20 bg-emerald-50/75">
                <Megaphone
                  size={18}
                  weight="duotone"
                  className="text-[#14532D] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-xs sm:text-sm font-semibold text-[#1C1917] leading-relaxed">
                  {settings.announcement}
                </p>
              </div>
            ) : null}

            {settings?.poster_url ? (
              <figure className="glass-elevated w-fit max-w-full mx-auto rounded-2xl overflow-hidden">
                <Image
                  src={settings.poster_url}
                  alt={`Poster promo ${storefront.businessName}`}
                  width={0}
                  height={0}
                  sizes="(max-width: 672px) 100vw, 672px"
                  style={{
                    width: "auto",
                    height: "auto",
                    maxWidth: "100%",
                  }}
                  className="block"
                />
                {settings.poster_caption ? (
                  <figcaption className="w-0 min-w-full px-4 py-3 text-xs sm:text-sm font-medium text-[#1C1917] border-t border-[#1C1917]/10">
                    {settings.poster_caption}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}

            {settings && !settings.is_open ? (
              <section className="glass-elevated rounded-2xl p-6 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-[#FEF3C7] text-[#92400E] flex items-center justify-center">
                  <Storefront size={26} weight="duotone" aria-hidden="true" />
                </div>
                <h1 className="text-lg font-extrabold text-[#1C1917]">
                  Pemesanan Online Tutup Sementara
                </h1>
                <p className="text-sm text-[#44403C] max-w-md mx-auto leading-relaxed">
                  {settings.closed_message ||
                    "Maaf, pemesanan online sedang tutup sementara."}
                </p>
                {storeWaNumber ? (
                  <div className="pt-1">
                    <a
                      href={`https://wa.me/${storeWaNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#166534]"
                    >
                      <WhatsappLogo size={18} weight="bold" aria-hidden="true" />
                      Hubungi Toko via WhatsApp
                    </a>
                  </div>
                ) : null}
              </section>
            ) : (
              <form onSubmit={handleSubmitDirectOrder} className="space-y-5">
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
                        {product.description ? (
                          <p className="text-xs sm:text-sm text-[#44403C] leading-relaxed">
                            {product.description}
                          </p>
                        ) : null}
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
                          <span className="block text-[11px] text-[#44403C]">
                            {activeDeliveryFee > 0 ? "Total + Ongkir" : "Subtotal Menu"}
                          </span>
                          <span className="text-lg font-extrabold text-[#B43D0A] tabular-nums">
                            {formatRupiah(totalAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Pickup Schedule & Delivery Option Card */}
                <section className="glass-panel rounded-2xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-[#1C1917]">
                      Pilih Pengambilan / Pengantaran
                    </h2>
                    <p className="text-xs text-[#44403C]">
                      Tentukan apakah pesanan diambil / COD langsung atau diantar ke kos Anda.
                    </p>
                  </div>

                  {settings?.pickup_info ? (
                    <div className="rounded-xl border border-[#14532D]/20 bg-emerald-50/80 px-3.5 py-2.5 flex items-start gap-2.5">
                      <Clock
                        size={18}
                        weight="duotone"
                        className="text-[#14532D] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="text-xs text-[#1C1917] leading-relaxed">
                        <p className="font-bold text-[#14532D]">Info Ready & Jadwal COD</p>
                        <p>{settings.pickup_info}</p>
                      </div>
                    </div>
                  ) : null}

                  {pickupEnabled || deliveryEnabled ? (
                    <div
                      className={`grid gap-2.5 ${
                        pickupEnabled && deliveryEnabled
                          ? "grid-cols-1 sm:grid-cols-2"
                          : "grid-cols-1"
                      }`}
                    >
                      {pickupEnabled ? (
                        <button
                          type="button"
                          onClick={() => setDeliveryType("pickup")}
                          className={`min-h-14 rounded-xl border p-3.5 text-left transition-colors cursor-pointer space-y-1 ${
                            deliveryType === "pickup"
                              ? "border-[#14532D] bg-[#14532D] text-white"
                              : "border-[#1C1917]/20 bg-white text-[#1C1917] hover:bg-black/[0.02]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold">
                              <MapPin size={16} weight="bold" aria-hidden="true" />
                              Ambil / COD di Lokasi
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0 ${
                                deliveryType === "pickup"
                                  ? "bg-white/20 text-white"
                                  : "bg-emerald-100 text-[#14532D]"
                              }`}
                            >
                              Gratis Ongkir
                            </span>
                          </div>
                          <p
                            className={`text-[11px] leading-snug ${
                              deliveryType === "pickup" ? "text-white/90" : "text-[#44403C]"
                            }`}
                          >
                            {settings?.pickup_info ||
                              "Ambil / COD di Telkom University Purwokerto (Hari Senin)"}
                          </p>
                        </button>
                      ) : null}

                      {deliveryEnabled ? (
                        <button
                          type="button"
                          onClick={() => setDeliveryType("delivery")}
                          className={`min-h-14 rounded-xl border p-3.5 text-left transition-colors cursor-pointer space-y-1 ${
                            deliveryType === "delivery"
                              ? "border-[#14532D] bg-[#14532D] text-white"
                              : "border-[#1C1917]/20 bg-white text-[#1C1917] hover:bg-black/[0.02]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold">
                              <Truck size={16} weight="bold" aria-hidden="true" />
                              Diantar ke Kos
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0 tabular-nums ${
                                deliveryType === "delivery"
                                  ? "bg-white/20 text-white"
                                  : "bg-[#FEF3C7] text-[#92400E]"
                              }`}
                            >
                              +{formatRupiah(configuredDeliveryFee)}
                            </span>
                          </div>
                          <p
                            className={`text-[11px] leading-snug ${
                              deliveryType === "delivery" ? "text-white/90" : "text-[#44403C]"
                            }`}
                          >
                            {settings?.delivery_info ||
                              `Tambah ongkir ${formatRupiah(configuredDeliveryFee)}, langsung diantar ke kos.`}
                          </p>
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {deliveryType === "delivery" && deliveryEnabled ? (
                    <div className="space-y-1.5 pt-1">
                      <label
                        htmlFor="deliveryAddress"
                        className="block text-xs font-semibold text-[#1C1917]"
                      >
                        Alamat Kos / Lokasi Pengantaran
                      </label>
                      <textarea
                        id="deliveryAddress"
                        rows={2}
                        required={deliveryType === "delivery"}
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Contoh: Kos Melati Kamar 5, Jl. DI Panjaitan (patokan depan warung/gerbang)"
                        className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
                      />
                      <p className="text-[11px] font-medium text-[#14532D] tabular-nums">
                        Ongkir antar +{formatRupiah(configuredDeliveryFee)} otomatis masuk ke total tagihan.
                      </p>
                    </div>
                  ) : null}
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
                </section>

                {/* Payment Method Section */}
                <section className="glass-panel rounded-2xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-[#1C1917]">Metode Pembayaran</h2>
                    <p className="text-xs text-[#44403C]">
                      Pilih Langsung Bayar (QRIS atau Transfer Bank), atau pesan Onsite lewat WhatsApp.
                    </p>
                  </div>

                  {directEnabled && onsiteEnabled ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setPayMode("direct")}
                        className={`min-h-12 rounded-xl border px-3 py-2 flex flex-col items-center justify-center gap-0.5 text-center transition-colors cursor-pointer ${
                          payMode === "direct"
                            ? "border-[#14532D] bg-[#14532D] text-white"
                            : "border-[#1C1917]/20 bg-white text-[#1C1917] hover:bg-black/[0.02]"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold">
                          <Wallet size={17} weight="bold" aria-hidden="true" />
                          Langsung Bayar
                        </span>
                        <span
                          className={`text-[11px] leading-tight ${
                            payMode === "direct" ? "text-white/85" : "text-[#44403C]"
                          }`}
                        >
                          QRIS / Transfer Bank
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPayMode("onsite")}
                        className={`min-h-12 rounded-xl border px-3 py-2 flex flex-col items-center justify-center gap-0.5 text-center transition-colors cursor-pointer ${
                          payMode === "onsite"
                            ? "border-[#B43D0A] bg-[#B43D0A] text-white"
                            : "border-[#1C1917]/20 bg-white text-[#1C1917] hover:bg-black/[0.02]"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold">
                          <WhatsappLogo size={17} weight="bold" aria-hidden="true" />
                          Onsite
                        </span>
                        <span
                          className={`text-[11px] leading-tight ${
                            payMode === "onsite" ? "text-white/85" : "text-[#44403C]"
                          }`}
                        >
                          Bayar di Tempat (WA)
                        </span>
                      </button>
                    </div>
                  ) : null}

                  {payMode === "direct" && directEnabled ? (
                    <div className="space-y-4">
                      {qrisEnabled && transferEnabled ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-[#44403C]">
                            Pilih Cara Langsung Bayar:
                          </p>
                          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/[0.05] p-1">
                            <button
                              type="button"
                              onClick={() => setDirectMethod("qris")}
                              className={`min-h-10 rounded-lg px-3 py-1.5 inline-flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                                directMethod === "qris"
                                  ? "bg-white text-[#14532D] shadow-xs"
                                  : "text-[#44403C] hover:text-[#1C1917]"
                              }`}
                            >
                              <QrCode size={16} weight="bold" aria-hidden="true" />
                              <span>QRIS</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDirectMethod("transfer")}
                              className={`min-h-10 rounded-lg px-3 py-1.5 inline-flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                                directMethod === "transfer"
                                  ? "bg-white text-[#14532D] shadow-xs"
                                  : "text-[#44403C] hover:text-[#1C1917]"
                              }`}
                            >
                              <Bank size={16} weight="bold" aria-hidden="true" />
                              <span>Transfer Bank</span>
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {directMethod === "qris" && qrisEnabled ? (
                        <div className="space-y-4">
                          <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 text-center space-y-3">
                            <PaymentAmountBreakdown
                              title="Silakan scan atau simpan QRIS untuk total:"
                              quantity={quantity}
                              productSubtotal={productSubtotal}
                              deliveryFee={activeDeliveryFee}
                              totalAmount={totalAmount}
                            />

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
                                Gambar QRIS toko belum diunggah oleh penjual.
                              </p>
                            )}

                            <p className="text-xs text-[#44403C] leading-relaxed">
                              {settings?.qris_instruction ||
                                "Setelah berhasil transfer via QRIS, tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda."}
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
                      ) : transferEnabled ? (
                        <div className="space-y-4">
                          <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 space-y-3.5">
                            <PaymentAmountBreakdown
                              title="Silakan transfer tepat sesuai nominal:"
                              quantity={quantity}
                              productSubtotal={productSubtotal}
                              deliveryFee={activeDeliveryFee}
                              totalAmount={totalAmount}
                            />

                            {storefront.bankAccountNumber.trim() ? (
                              <div className="rounded-xl border border-[#14532D]/20 bg-[#14532D]/[0.04] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="space-y-0.5 min-w-0">
                                  <p className="text-xs font-bold uppercase tracking-wide text-[#44403C]">
                                    {storefront.bankName || "Transfer Bank"}
                                  </p>
                                  <p className="text-lg sm:text-xl font-extrabold text-[#14532D] tabular-nums tracking-wide break-all">
                                    {storefront.bankAccountNumber}
                                  </p>
                                  {storefront.bankAccountHolder ? (
                                    <p className="text-xs font-semibold text-[#1C1917]">
                                      a.n. {storefront.bankAccountHolder}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleCopyAccountNumber();
                                  }}
                                  className="min-h-10 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-white px-3.5 py-2 text-xs font-bold text-[#14532D] hover:bg-[#14532D]/5 cursor-pointer"
                                >
                                  {copiedRek ? (
                                    <Check size={15} weight="bold" aria-hidden="true" />
                                  ) : (
                                    <Copy size={15} weight="bold" aria-hidden="true" />
                                  )}
                                  <span>{copiedRek ? "Tersalin!" : "Salin Rekening"}</span>
                                </button>
                              </div>
                            ) : (
                              <p className="text-xs text-[#B43D0A] bg-[#FEF3C7] rounded-xl p-3 text-center">
                                Nomor rekening bank toko belum diatur oleh penjual.
                              </p>
                            )}

                            <p className="text-xs text-[#44403C] leading-relaxed text-center">
                              {settings?.transfer_instruction ||
                                "Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda."}
                            </p>
                          </div>

                          <button
                            type="submit"
                            disabled={submitting || !storefront.bankAccountNumber.trim()}
                            className="min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors cursor-pointer"
                          >
                            {submitting
                              ? "Mengirim pesanan..."
                              : `Konfirmasi Sudah Bayar (${formatRupiah(totalAmount)})`}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : onsiteEnabled ? (
                    <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 space-y-3">
                      <p className="text-sm font-bold text-[#1C1917]">
                        Pemesanan Onsite via Chat WhatsApp
                      </p>
                      <p className="text-xs text-[#44403C] leading-relaxed">
                        {settings?.cash_instruction ||
                          "Untuk menjaga ketersediaan stok, pemesanan onsite (bayar di tempat) langsung dikonfirmasi lewat chat WhatsApp dengan detail pesanan Anda."}
                      </p>
                      {activeDeliveryFee > 0 ? (
                        <p className="text-xs font-semibold text-[#14532D] tabular-nums">
                          Total Menu {formatRupiah(productSubtotal)} + Ongkir Antar{" "}
                          {formatRupiah(activeDeliveryFee)} = {formatRupiah(totalAmount)}
                        </p>
                      ) : null}
                      {deliveryType === "delivery" && deliveryAddress.trim().length < 5 ? (
                        <p className="text-xs font-medium text-[#B43D0A] bg-[#FEF3C7] rounded-xl px-3 py-2">
                          Isi alamat kos lengkap di bagian atas terlebih dahulu sebelum lanjut ke WhatsApp.
                        </p>
                      ) : null}
                      {storeWaNumber ? (
                        <a
                          href={buildOnsiteChatUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (
                              deliveryType === "delivery" &&
                              deliveryAddress.trim().length < 5
                            ) {
                              e.preventDefault();
                              setErrorMsg(
                                "Mohon isi alamat kos lengkap terlebih dahulu untuk pengantaran."
                              );
                            } else {
                              setErrorMsg(null);
                            }
                          }}
                          className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#9A3412] transition-colors"
                        >
                          <WhatsappLogo size={20} weight="bold" aria-hidden="true" />
                          Pesan Onsite via WhatsApp ({formatRupiah(totalAmount)})
                        </a>
                      ) : (
                        <p className="text-xs text-[#B43D0A]">
                          Nomor WhatsApp toko belum diatur oleh penjual.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#B43D0A]">
                      Metode pembayaran belum diaktifkan oleh penjual.
                    </p>
                  )}
                </section>
              </form>
            )}
          </div>
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

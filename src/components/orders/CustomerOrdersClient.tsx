"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowSquareOut,
  Check,
  CheckCircle,
  Copy,
  Database,
  FloppyDisk,
  ImageSquare,
  MapPin,
  Package,
  ShoppingBag,
  SlidersHorizontal,
  Trash,
  Truck,
  UploadSimple,
  WhatsappLogo,
  XCircle,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { formatDateId, formatRupiah, normalizeWhatsAppPhone } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import {
  getCustomerPaymentMethodLabel,
  resolveCustomerOrderDelivery,
  resolveCustomerOrderPaymentMethod,
  stripInternalPaymentTag,
} from "@/lib/customer-order-payment";
import type {
  CustomerOrder,
  Product,
  StorefrontSettings,
} from "@/types/database";
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
  payment_method TEXT NOT NULL DEFAULT 'qris' CHECK (payment_method IN ('qris', 'transfer')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'rejected')),
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery')),
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_address TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  business_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_open BOOLEAN NOT NULL DEFAULT true,
  closed_message TEXT NOT NULL DEFAULT 'Maaf, pemesanan online sedang tutup sementara. Silakan hubungi WhatsApp kami.',
  poster_url TEXT,
  poster_caption TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  featured_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  custom_title TEXT NOT NULL DEFAULT '',
  custom_description TEXT NOT NULL DEFAULT '',
  custom_price NUMERIC(14,2) CHECK (custom_price IS NULL OR custom_price >= 0),
  enable_qris BOOLEAN NOT NULL DEFAULT true,
  enable_transfer BOOLEAN NOT NULL DEFAULT true,
  enable_cash_chat BOOLEAN NOT NULL DEFAULT true,
  qris_instruction TEXT NOT NULL DEFAULT 'Setelah berhasil transfer via QRIS, tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.',
  transfer_instruction TEXT NOT NULL DEFAULT 'Transfer tepat sesuai nominal ke rekening bank di atas, lalu tekan tombol konfirmasi di bawah agar penjual memvalidasi pembayaran dan menyiapkan pesanan Anda.',
  cash_instruction TEXT NOT NULL DEFAULT 'Untuk menjaga ketersediaan stok, pemesanan onsite (bayar di tempat) langsung dikonfirmasi lewat chat WhatsApp dengan detail pesanan Anda.',
  enable_pickup BOOLEAN NOT NULL DEFAULT true,
  enable_delivery BOOLEAN NOT NULL DEFAULT true,
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 2000 CHECK (delivery_fee >= 0),
  pickup_info TEXT NOT NULL DEFAULT 'Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB.',
  delivery_info TEXT NOT NULL DEFAULT 'Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000).',
  whatsapp_number TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_storefront_settings_updated_at ON public.storefront_settings;
CREATE TRIGGER trg_storefront_settings_updated_at
  BEFORE UPDATE ON public.storefront_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storefront_settings_team_select ON public.storefront_settings;
CREATE POLICY storefront_settings_team_select ON public.storefront_settings
  FOR SELECT USING (
    public.get_my_role() IN ('owner', 'cashier')
    AND business_id = public.get_my_business_id()
  );

DROP POLICY IF EXISTS storefront_settings_owner_write ON public.storefront_settings;
CREATE POLICY storefront_settings_owner_write ON public.storefront_settings
  FOR ALL USING (
    public.get_my_role() = 'owner'
    AND business_id = public.get_my_business_id()
  )
  WITH CHECK (
    public.get_my_role() = 'owner'
    AND business_id = public.get_my_business_id()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'customer_orders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'storefront_settings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.storefront_settings;
    END IF;
  END IF;
END;
$$;`;

function serializeStorefrontSettings(s: StorefrontSettings): string {
  return JSON.stringify({
    is_open: s.is_open,
    closed_message: s.closed_message,
    poster_url: s.poster_url,
    poster_caption: s.poster_caption,
    announcement: s.announcement,
    featured_product_id: s.featured_product_id ?? "",
    custom_title: s.custom_title,
    custom_description: s.custom_description,
    custom_price: s.custom_price ?? null,
    enable_qris: s.enable_qris,
    enable_transfer: s.enable_transfer ?? true,
    enable_cash_chat: s.enable_cash_chat,
    qris_instruction: s.qris_instruction,
    transfer_instruction: s.transfer_instruction,
    cash_instruction: s.cash_instruction,
    enable_pickup: s.enable_pickup ?? true,
    enable_delivery: s.enable_delivery ?? true,
    delivery_fee: s.delivery_fee ?? 2000,
    pickup_info: s.pickup_info ?? "",
    delivery_info: s.delivery_info ?? "",
    whatsapp_number: s.whatsapp_number,
  });
}

interface CustomerOrdersClientProps {
  tableMissing: boolean;
  isOwner: boolean;
  businessId: string;
  businessName: string;
  bankSummary?: string;
  initialOrders: CustomerOrder[];
  initialSettings: StorefrontSettings;
  products: Product[];
}

export function CustomerOrdersClient({
  tableMissing,
  isOwner,
  businessId,
  businessName,
  bankSummary = "",
  initialOrders,
  initialSettings,
  products,
}: CustomerOrdersClientProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<"orders" | "storefront">("orders");
  const [orders, setOrders] = useState<CustomerOrder[]>(initialOrders);
  const [filter, setFilter] = useState<"active" | "all" | "done">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerOrder | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Storefront Settings Form State (Owner)
  const [isOpen, setIsOpen] = useState(initialSettings.is_open);
  const [closedMessage, setClosedMessage] = useState(initialSettings.closed_message);
  const [posterUrl, setPosterUrl] = useState<string | null>(initialSettings.poster_url);
  const [posterCaption, setPosterCaption] = useState(initialSettings.poster_caption);
  const [announcement, setAnnouncement] = useState(initialSettings.announcement);
  const [featuredProductId, setFeaturedProductId] = useState(
    initialSettings.featured_product_id ?? ""
  );
  const [customTitle, setCustomTitle] = useState(initialSettings.custom_title);
  const [customDescription, setCustomDescription] = useState(
    initialSettings.custom_description
  );
  const [customPriceInput, setCustomPriceInput] = useState(
    initialSettings.custom_price !== null && initialSettings.custom_price !== undefined
      ? String(initialSettings.custom_price)
      : ""
  );
  const [enableQris, setEnableQris] = useState(initialSettings.enable_qris);
  const [enableTransfer, setEnableTransfer] = useState(
    initialSettings.enable_transfer ?? true
  );
  const [enableCashChat, setEnableCashChat] = useState(initialSettings.enable_cash_chat);
  const [qrisInstruction, setQrisInstruction] = useState(
    initialSettings.qris_instruction
  );
  const [transferInstruction, setTransferInstruction] = useState(
    initialSettings.transfer_instruction
  );
  const [cashInstruction, setCashInstruction] = useState(
    initialSettings.cash_instruction
  );
  const [enablePickup, setEnablePickup] = useState(initialSettings.enable_pickup ?? true);
  const [enableDelivery, setEnableDelivery] = useState(
    initialSettings.enable_delivery ?? true
  );
  const [deliveryFeeInput, setDeliveryFeeInput] = useState(
    String(initialSettings.delivery_fee ?? 2000)
  );
  const [pickupInfo, setPickupInfo] = useState(
    initialSettings.pickup_info ??
      "Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB."
  );
  const [deliveryInfo, setDeliveryInfo] = useState(
    initialSettings.delivery_info ??
      "Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000)."
  );
  const [whatsappNumber, setWhatsappNumber] = useState(initialSettings.whatsapp_number);
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsDirtyRef = useRef(false);
  const lastSyncedSettingsRef = useRef(
    serializeStorefrontSettings(initialSettings)
  );

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    const incomingSerialized = serializeStorefrontSettings(initialSettings);
    if (incomingSerialized === lastSyncedSettingsRef.current) {
      return;
    }
    if (settingsDirtyRef.current) {
      return;
    }

    lastSyncedSettingsRef.current = incomingSerialized;
    setIsOpen(initialSettings.is_open);
    setClosedMessage(initialSettings.closed_message);
    setPosterUrl(initialSettings.poster_url);
    setPosterCaption(initialSettings.poster_caption);
    setAnnouncement(initialSettings.announcement);
    setFeaturedProductId(initialSettings.featured_product_id ?? "");
    setCustomTitle(initialSettings.custom_title);
    setCustomDescription(initialSettings.custom_description);
    setCustomPriceInput(
      initialSettings.custom_price !== null && initialSettings.custom_price !== undefined
        ? String(initialSettings.custom_price)
        : ""
    );
    setEnableQris(initialSettings.enable_qris);
    setEnableTransfer(initialSettings.enable_transfer ?? true);
    setEnableCashChat(initialSettings.enable_cash_chat);
    setQrisInstruction(initialSettings.qris_instruction);
    setTransferInstruction(initialSettings.transfer_instruction);
    setCashInstruction(initialSettings.cash_instruction);
    setEnablePickup(initialSettings.enable_pickup ?? true);
    setEnableDelivery(initialSettings.enable_delivery ?? true);
    setDeliveryFeeInput(String(initialSettings.delivery_fee ?? 2000));
    setPickupInfo(
      initialSettings.pickup_info ??
        "Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB."
    );
    setDeliveryInfo(
      initialSettings.delivery_info ??
        "Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000)."
    );
    setWhatsappNumber(initialSettings.whatsapp_number);
  }, [initialSettings]);

  const persistStorefront = async (overridePosterUrl?: string | null) => {
    const resolvedPoster = overridePosterUrl !== undefined ? overridePosterUrl : posterUrl;
    const trimmedPrice = customPriceInput.trim();
    const parsedPrice = trimmedPrice === "" ? null : Math.max(0, Number(trimmedPrice) || 0);
    const parsedDeliveryFee = Math.max(0, Number(deliveryFeeInput) || 0);

    const res = await fetch("/api/storefront", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_open: isOpen,
        closed_message: closedMessage.trim(),
        poster_url: resolvedPoster,
        poster_caption: posterCaption.trim(),
        announcement: announcement.trim(),
        featured_product_id: featuredProductId || null,
        custom_title: customTitle.trim(),
        custom_description: customDescription.trim(),
        custom_price: parsedPrice,
        enable_qris: enableQris,
        enable_transfer: enableTransfer,
        enable_cash_chat: enableCashChat,
        qris_instruction: qrisInstruction.trim(),
        transfer_instruction: transferInstruction.trim(),
        cash_instruction: cashInstruction.trim(),
        enable_pickup: enablePickup,
        enable_delivery: enableDelivery,
        delivery_fee: parsedDeliveryFee,
        pickup_info: pickupInfo.trim(),
        delivery_info: deliveryInfo.trim(),
        whatsapp_number: whatsappNumber.trim(),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error ?? "Gagal menyimpan pengaturan halaman pembeli.");
    }
    const saved = json.settings as StorefrontSettings;
    settingsDirtyRef.current = false;
    lastSyncedSettingsRef.current = serializeStorefrontSettings(saved);
    return { settings: saved, needsMigration: Boolean(json.needsMigration) };
  };

  const handlePosterUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPoster(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filePath = `${businessId}/poster-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("store-assets")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) {
        throw new Error(`Gagal mengunggah poster: ${uploadErr.message}`);
      }

      const { data: pub } = supabase.storage.from("store-assets").getPublicUrl(filePath);
      const url = pub.publicUrl;
      setPosterUrl(url);
      await persistStorefront(url);
      setSuccessMsg("Poster berhasil dipasang dan langsung tampil di halaman pembeli (/pesan).");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal mengunggah poster.");
    } finally {
      setUploadingPoster(false);
      e.target.value = "";
    }
  };

  const handleRemovePoster = async () => {
    setUploadingPoster(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      setPosterUrl(null);
      await persistStorefront(null);
      setSuccessMsg("Poster dihapus dari halaman pembeli.");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menghapus poster.");
    } finally {
      setUploadingPoster(false);
    }
  };

  const handleSaveStorefrontSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { needsMigration } = await persistStorefront();
      setSuccessMsg(
        needsMigration
          ? "Pengaturan utama tersimpan. Jalankan SQL migrasi 006 di Supabase agar perubahan jadwal & ongkir ikut tersimpan permanen."
          : "Pengaturan halaman pembeli berhasil disimpan dan langsung live!"
      );
      router.refresh();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyimpan pengaturan halaman pembeli."
      );
    } finally {
      setSavingSettings(false);
    }
  };

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
    const methodLabel = getCustomerPaymentMethodLabel(
      resolveCustomerOrderPaymentMethod(order)
    );
    const delivery = resolveCustomerOrderDelivery(order);
    const readySuffix =
      delivery.delivery_type === "delivery"
        ? ` dan siap diantar ke alamat: ${delivery.delivery_address || "kos Anda"} ya!`
        : ` dan bisa diambil / COD sesuai jadwal (${pickupInfo.trim() || "Telkom University Purwokerto"}) ya!`;
    const text =
      order.fulfillment_status === "ready"
        ? `Halo Kak ${order.customer_name}, pesanan ${order.order_number} (${order.quantity}x ${order.product_name}) di ${businessName || "Nummie"} sudah jadi${readySuffix}`
        : order.payment_status === "paid"
          ? `Halo Kak ${order.customer_name}, pembayaran ${methodLabel} pesanan ${order.order_number} sudah kami terima dan sedang dibuat ya.`
          : `Halo Kak ${order.customer_name}, mengenai pesanan ${order.order_number} (${order.quantity}x ${order.product_name}) total ${formatRupiah(order.total_amount)}, bisa bantu kirim bukti bayar ${methodLabel}-nya?`;
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

      {isOwner ? (
        <div className="flex flex-wrap gap-2 border-b border-[#1C1917]/10 pb-3">
          <button
            type="button"
            onClick={() => setActiveSection("orders")}
            className={`min-h-11 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              activeSection === "orders"
                ? "bg-[#14532D] text-white"
                : "glass-panel text-[#1C1917] hover:bg-white"
            }`}
          >
            <ShoppingBag size={17} weight="bold" aria-hidden="true" />
            <span>Pesanan Masuk ({orders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("storefront")}
            className={`min-h-11 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              activeSection === "storefront"
                ? "bg-[#B43D0A] text-white"
                : "glass-panel text-[#1C1917] hover:bg-white"
            }`}
          >
            <SlidersHorizontal size={17} weight="bold" aria-hidden="true" />
            <span>Atur Halaman Pembeli & Poster</span>
          </button>
        </div>
      ) : null}

      {activeSection === "storefront" && isOwner ? (
        <form
          onSubmit={handleSaveStorefrontSettings}
          onChangeCapture={() => {
            settingsDirtyRef.current = true;
          }}
          className="space-y-5 max-w-4xl"
        >
          {/* Status Toko & Pengumuman */}
          <section className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#1C1917]">
                  Status Buka / Tutup Pemesanan Online
                </h2>
                <p className="text-xs text-[#44403C]">
                  Matikan sementara jika stok habis atau toko sedang libur agar pembeli tidak bisa membuat pesanan baru.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    settingsDirtyRef.current = true;
                    setIsOpen(true);
                  }}
                  className={`min-h-10 rounded-lg px-3.5 text-xs font-bold cursor-pointer ${
                    isOpen ? "bg-[#14532D] text-white" : "text-[#44403C]"
                  }`}
                >
                  Sedang Buka
                </button>
                <button
                  type="button"
                  onClick={() => {
                    settingsDirtyRef.current = true;
                    setIsOpen(false);
                  }}
                  className={`min-h-10 rounded-lg px-3.5 text-xs font-bold cursor-pointer ${
                    !isOpen ? "bg-[#B91C1C] text-white" : "text-[#44403C]"
                  }`}
                >
                  Tutup Sementara
                </button>
              </div>
            </div>

            {!isOpen ? (
              <div className="space-y-1.5">
                <label htmlFor="sfClosedMsg" className="block text-xs font-semibold text-[#1C1917]">
                  Pesan Saat Toko Tutup
                </label>
                <input
                  id="sfClosedMsg"
                  type="text"
                  value={closedMessage}
                  onChange={(e) => setClosedMessage(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="sfAnnouncement" className="block text-xs font-semibold text-[#1C1917]">
                Teks Pengumuman Atas (Opsional)
              </label>
              <input
                id="sfAnnouncement"
                type="text"
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="Contoh: Ready setiap hari jam 15.00 - 21.00 WIB di Mikost GOR Satria"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
              />
            </div>
          </section>

          {/* Poster Promo Upload */}
          <section className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ImageSquare size={20} weight="duotone" className="text-[#B43D0A]" aria-hidden="true" />
              <div>
                <h2 className="text-base font-bold text-[#1C1917]">
                  Poster / Banner Halaman Pembeli
                </h2>
                <p className="text-xs text-[#44403C]">
                  Tempel poster menu atau promo yang langsung tampil utuh di bagian atas halaman `/pesan`.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start gap-4">
              {posterUrl ? (
                <div className="w-fit max-w-full sm:max-w-60 rounded-2xl border border-[#1C1917]/15 bg-white overflow-hidden shrink-0">
                  <Image
                    src={posterUrl}
                    alt="Pratinjau poster halaman pembeli"
                    width={0}
                    height={0}
                    sizes="(max-width: 640px) 100vw, 240px"
                    style={{
                      width: "auto",
                      height: "auto",
                      maxWidth: "100%",
                      maxHeight: "18rem",
                    }}
                    className="block"
                  />
                </div>
              ) : (
                <div className="w-full sm:w-56 h-40 rounded-2xl border border-dashed border-[#1C1917]/20 bg-white/75 flex flex-col items-center justify-center gap-1.5 text-xs text-[#44403C] shrink-0">
                  <ImageSquare size={28} aria-hidden="true" />
                  <span>Belum ada poster</span>
                </div>
              )}

              <div className="flex-1 w-full space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="poster-upload"
                    className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#9A3412] cursor-pointer"
                  >
                    <UploadSimple size={16} weight="bold" aria-hidden="true" />
                    {uploadingPoster
                      ? "Mengunggah poster..."
                      : posterUrl
                        ? "Ganti Poster"
                        : "Unggah Poster"}
                  </label>
                  <input
                    id="poster-upload"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handlePosterUpload}
                  />

                  {posterUrl ? (
                    <button
                      type="button"
                      disabled={uploadingPoster}
                      onClick={() => {
                        void handleRemovePoster();
                      }}
                      className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-[#B91C1C]/30 bg-white px-3.5 py-2 text-xs font-bold text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                    >
                      <Trash size={15} weight="bold" aria-hidden="true" />
                      Hapus Poster
                    </button>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sfPosterCaption" className="block text-xs font-semibold text-[#1C1917]">
                    Keterangan Singkat di Bawah Poster (Opsional)
                  </label>
                  <input
                    id="sfPosterCaption"
                    type="text"
                    value={posterCaption}
                    onChange={(e) => setPosterCaption(e.target.value)}
                    placeholder="Contoh: Promo paket hemat coklat & keju lumer!"
                    className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Menu, Title, Price & Description */}
          <section className="glass-panel rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#1C1917]">
              Menu, Harga & Deskripsi Halaman Pembeli
            </h2>

            <div className="space-y-1.5">
              <label htmlFor="sfProduct" className="block text-xs font-semibold text-[#1C1917]">
                Pilih Menu yang Ditampilkan
              </label>
              <select
                id="sfProduct"
                value={featuredProductId}
                onChange={(e) => setFeaturedProductId(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3 text-sm text-[#1C1917]"
              >
                <option value="">Otomatis (Paket Lumpia Ubi Ungu / Menu Pertama)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {formatRupiah(p.price)}
                    {!p.is_active ? " (Nonaktif)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="sfCustomTitle" className="block text-xs font-semibold text-[#1C1917]">
                  Judul Tampilan Menu (Opsional)
                </label>
                <input
                  id="sfCustomTitle"
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Kosongkan untuk pakai nama menu asli"
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sfCustomPrice" className="block text-xs font-semibold text-[#1C1917]">
                  Harga Khusus Halaman Pembeli (Opsional, Rp)
                </label>
                <input
                  id="sfCustomPrice"
                  type="number"
                  min="0"
                  step="1"
                  value={customPriceInput}
                  onChange={(e) => setCustomPriceInput(e.target.value)}
                  placeholder="Kosongkan untuk ikut harga menu normal"
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917] tabular-nums"
                />
                {customPriceInput.trim() !== "" ? (
                  <p className="text-[11px] font-semibold text-[#14532D] tabular-nums">
                    Harga tampil: {formatRupiah(Number(customPriceInput) || 0)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sfDesc" className="block text-xs font-semibold text-[#1C1917]">
                Deskripsi Menu / Info Isi Paket
              </label>
              <textarea
                id="sfDesc"
                rows={2}
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Contoh: Lumpia ubi ungu hangat dengan isian coklat lumer dan keju melimpah."
                className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>
          </section>

          {/* Payment Options & Instructions */}
          <section className="glass-panel rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#1C1917]">
              Metode Pembayaran & WhatsApp Tujuan
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm font-semibold text-[#1C1917] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableQris}
                  onChange={(e) => setEnableQris(e.target.checked)}
                  className="w-4 h-4 accent-[#14532D]"
                />
                <span>Langsung Bayar: QRIS</span>
              </label>

              <label className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm font-semibold text-[#1C1917] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableTransfer}
                  onChange={(e) => setEnableTransfer(e.target.checked)}
                  className="w-4 h-4 accent-[#14532D]"
                />
                <span>Langsung Bayar: Transfer Bank</span>
              </label>

              <label className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm font-semibold text-[#1C1917] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableCashChat}
                  onChange={(e) => setEnableCashChat(e.target.checked)}
                  className="w-4 h-4 accent-[#B43D0A]"
                />
                <span>Onsite (Chat WA)</span>
              </label>
            </div>

            {enableTransfer ? (
              <p className="text-xs text-[#44403C] bg-black/[0.04] rounded-xl px-3.5 py-2.5">
                Rekening Transfer Bank aktif:{" "}
                <strong className="text-[#1C1917]">
                  {bankSummary || "Belum diatur"}
                </strong>
                . Ubah nomor rekening melalui menu{" "}
                <Link href="/pengaturan-bisnis" className="font-semibold text-[#14532D] underline">
                  Pengaturan Bisnis
                </Link>
                .
              </p>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="sfQrisInstr" className="block text-xs font-semibold text-[#1C1917]">
                Teks Petunjuk Bayar QRIS
              </label>
              <textarea
                id="sfQrisInstr"
                rows={2}
                value={qrisInstruction}
                onChange={(e) => setQrisInstruction(e.target.value)}
                className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sfTransferInstr" className="block text-xs font-semibold text-[#1C1917]">
                Teks Petunjuk Transfer Bank
              </label>
              <textarea
                id="sfTransferInstr"
                rows={2}
                value={transferInstruction}
                onChange={(e) => setTransferInstruction(e.target.value)}
                className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sfCashInstr" className="block text-xs font-semibold text-[#1C1917]">
                Teks Petunjuk Onsite (Chat WA)
              </label>
              <textarea
                id="sfCashInstr"
                rows={2}
                value={cashInstruction}
                onChange={(e) => setCashInstruction(e.target.value)}
                className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sfWaNum" className="block text-xs font-semibold text-[#1C1917]">
                No. WhatsApp Tujuan Order Pembeli (Opsional)
              </label>
              <input
                id="sfWaNum"
                type="tel"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="Kosongkan untuk otomatis pakai nomor toko di Pengaturan Bisnis"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917] tabular-nums"
              />
            </div>
          </section>

          {/* Pickup Schedule & Kos Delivery Settings */}
          <section className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[#1C1917]">
                Jadwal COD / Ambil & Pengantaran ke Kos
              </h2>
              <p className="text-xs text-[#44403C]">
                Atur jadwal pengambilan hari Senin di Telkom University Purwokerto serta ongkos kirim antar ke kos.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm font-semibold text-[#1C1917] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enablePickup}
                  onChange={(e) => setEnablePickup(e.target.checked)}
                  className="w-4 h-4 accent-[#14532D]"
                />
                <span>Aktifkan Ambil / COD di Lokasi (Gratis)</span>
              </label>

              <label className="min-h-11 rounded-xl border border-[#1C1917]/15 bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm font-semibold text-[#1C1917] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableDelivery}
                  onChange={(e) => setEnableDelivery(e.target.checked)}
                  className="w-4 h-4 accent-[#B43D0A]"
                />
                <span>Aktifkan Diantar ke Kos (+Ongkir)</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sfPickupInfo" className="block text-xs font-semibold text-[#1C1917]">
                Jadwal Ready & Lokasi COD / Ambil (Edit Jam Hari Senin di Sini)
              </label>
              <textarea
                id="sfPickupInfo"
                rows={2}
                value={pickupInfo}
                onChange={(e) => setPickupInfo(e.target.value)}
                placeholder="Contoh: Ready hari Senin! Bisa ambil / COD di Telkom University Purwokerto pukul 10.00 - 16.00 WIB."
                className="w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="sfDeliveryFee" className="block text-xs font-semibold text-[#1C1917]">
                  Biaya Ongkir Antar ke Kos (Rp)
                </label>
                <input
                  id="sfDeliveryFee"
                  type="number"
                  min={0}
                  step={500}
                  value={deliveryFeeInput}
                  onChange={(e) => setDeliveryFeeInput(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917] tabular-nums"
                />
                <p className="text-[11px] font-semibold text-[#14532D] tabular-nums">
                  Ongkir aktif: +{formatRupiah(Number(deliveryFeeInput) || 0)}
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sfDeliveryInfo" className="block text-xs font-semibold text-[#1C1917]">
                  Keterangan Pengantaran ke Kos
                </label>
                <input
                  id="sfDeliveryInfo"
                  type="text"
                  value={deliveryInfo}
                  onChange={(e) => setDeliveryInfo(e.target.value)}
                  placeholder="Contoh: Diantar langsung ke area kos Purwokerto (ongkir Rp 2.000)."
                  className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
                />
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={savingSettings}
                className="min-h-12 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-6 py-3 text-sm font-extrabold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
              >
                <FloppyDisk size={18} weight="bold" aria-hidden="true" />
                {savingSettings
                  ? "Menyimpan..."
                  : "Simpan Pengaturan Halaman Pembeli"}
              </button>
            </div>
          </section>
        </form>
      ) : (
        <>
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
            const methodLabel = getCustomerPaymentMethodLabel(
              resolveCustomerOrderPaymentMethod(order)
            );
            const delivery = resolveCustomerOrderDelivery(order);
            const cleanNotes = stripInternalPaymentTag(order.notes);
            const menuSubtotal = Number(order.unit_price) * Number(order.quantity);

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
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold inline-flex items-center gap-1 ${
                          delivery.delivery_type === "delivery"
                            ? "bg-[#B43D0A]/15 text-[#B43D0A]"
                            : "bg-black/8 text-[#1C1917]"
                        }`}
                      >
                        {delivery.delivery_type === "delivery" ? (
                          <>
                            <Truck size={12} weight="bold" aria-hidden="true" />
                            <span>
                              Diantar ke Kos (+{formatRupiah(delivery.delivery_fee)})
                            </span>
                          </>
                        ) : (
                          <>
                            <MapPin size={12} weight="bold" aria-hidden="true" />
                            <span>Ambil / COD</span>
                          </>
                        )}
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
                          ? `Sudah Bayar (${methodLabel})`
                          : order.payment_status === "rejected"
                            ? "Dibatalkan"
                            : `Belum Validasi (${methodLabel})`}
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

                    {delivery.delivery_type === "delivery" && delivery.delivery_address ? (
                      <p className="text-xs text-[#1C1917] bg-[#FEF3C7]/70 border border-[#92400E]/20 rounded-lg px-2.5 py-1.5">
                        <strong>Alamat Kos:</strong> {delivery.delivery_address}
                      </p>
                    ) : null}

                    {cleanNotes ? (
                      <p className="text-xs text-[#44403C] bg-black/5 rounded-lg px-2.5 py-1.5 inline-block">
                        Catatan: {cleanNotes}
                      </p>
                    ) : null}

                    <p className="text-[11px] text-[#44403C]">
                      Masuk: {formatDateId(order.created_at, true)}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[11px] text-[#44403C]">Total {methodLabel}</p>
                    <p className="text-xl font-extrabold text-[#14532D] tabular-nums">
                      {formatRupiah(order.total_amount)}
                    </p>
                    {delivery.delivery_type === "delivery" ? (
                      <p className="text-[11px] text-[#44403C] tabular-nums">
                        Menu {formatRupiah(menuSubtotal)} + Ongkir{" "}
                        {formatRupiah(delivery.delivery_fee)}
                      </p>
                    ) : null}
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
        </>
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

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowsOutSimple,
  Bank,
  CheckCircle,
  Copy,
  LockKey,
  MagnifyingGlass,
  Minus,
  Money,
  Plus,
  QrCode,
  ShoppingBag,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type {
  CashierShift,
  Order,
  PaymentMethod,
  Product,
  ProductCategory,
  ShiftSummary,
  StorePosConfig,
} from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState } from "@/components/ui/StatePanel";
import { ReceiptModal } from "@/components/pos/ReceiptModal";

const CATEGORIES: Array<"Semua" | ProductCategory> = [
  "Semua",
  "Makanan",
  "Minuman",
  "Paket",
  "Topping",
];

const QUICK_CASH_VALUES = [10000, 20000, 50000, 100000];

interface CartEntry {
  product: Product;
  quantity: number;
}

interface PosTerminalClientProps {
  initialProducts: Product[];
  initialShift: CashierShift | null;
  storeConfig: StorePosConfig;
}

export function PosTerminalClient({
  initialProducts,
  initialShift,
  storeConfig,
}: PosTerminalClientProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [activeShift, setActiveShift] = useState<CashierShift | null>(initialShift);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);
  const [category, setCategory] = useState<"Semua" | ProductCategory>("Semua");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [discountMode, setDiscountMode] = useState<"rp" | "pct">("rp");
  const [discountInput, setDiscountInput] = useState("0");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Close Shift Modal
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [actualCashInput, setActualCashInput] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closingLoading, setClosingLoading] = useState(false);

  // Checkout Modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashPaidInput, setCashPaidInput] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [copiedRek, setCopiedRek] = useState(false);
  const [qrisFullscreen, setQrisFullscreen] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!qrisFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setQrisFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [qrisFullscreen]);

  // Cache active catalog locally for offline fallback inspection
  useEffect(() => {
    if (initialProducts.length > 0) {
      try {
        window.localStorage.setItem(
          `kulinerkas_pos_menu_${storeConfig.business_id}`,
          JSON.stringify(initialProducts)
        );
      } catch {
        // Ignore storage quota errors
      }
    } else {
      try {
        const cached = window.localStorage.getItem(
          `kulinerkas_pos_menu_${storeConfig.business_id}`
        );
        if (cached) {
          setProducts(JSON.parse(cached) as Product[]);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [initialProducts, storeConfig.business_id]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.is_active) return false;
      if (category !== "Semua" && p.category !== category) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, category, search]);

  const cartQtyMap = useMemo(() => {
    return new Map(cart.map((c) => [c.product.id, c.quantity]));
  }, [cart]);

  const subtotal = useMemo(
    () => cart.reduce((s, c) => s + Number(c.product.price) * c.quantity, 0),
    [cart]
  );

  const discountAmount = useMemo(() => {
    const raw = Math.max(0, Number(discountInput) || 0);
    if (discountMode === "pct") {
      return Math.min(subtotal, Math.round(subtotal * (Math.min(100, raw) / 100)));
    }
    return Math.min(subtotal, raw);
  }, [discountInput, discountMode, subtotal]);

  const taxable = Math.max(0, subtotal - discountAmount);
  const serviceAmount = Math.round(
    taxable * ((Number(storeConfig.service_charge_rate) || 0) / 100)
  );
  const taxAmount = Math.round(taxable * ((Number(storeConfig.tax_rate) || 0) / 100));
  const grandTotal = taxable + serviceAmount + taxAmount;
  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  const cashPaidNum = Number(cashPaidInput) || 0;
  const changeAmount = Math.max(0, cashPaidNum - grandTotal);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        return prev.map((c, i) =>
          i === idx ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const openCloseShiftDialog = async () => {
    if (!activeShift) return;
    setErrorMsg(null);
    setCloseShiftOpen(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_shift_summary", {
      p_shift_id: activeShift.id,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const summary = data as ShiftSummary;
    setShiftSummary(summary);
    setActualCashInput(String(summary.expected_cash));
  };

  const handleCloseShift = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    setClosingLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_cashier_shift", {
        p_shift_id: activeShift.id,
        p_actual_cash: Math.max(0, Number(actualCashInput) || 0),
        p_notes: closeNotes.trim(),
      });
      if (error) throw new Error(error.message);
      setActiveShift(null);
      setCloseShiftOpen(false);
      setShiftSummary(null);
      setCloseNotes("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menutup shift kasir.");
    } finally {
      setClosingLoading(false);
    }
  };

  const openPaymentModal = () => {
    setErrorMsg(null);
    setPaymentMethod("cash");
    setCashPaidInput(String(grandTotal));
    setCustomerName("");
    setQrisFullscreen(false);
    setMobileCartOpen(false);
    setCheckoutOpen(true);
  };

  const submitCheckoutOrder = async () => {
    if (cart.length === 0) return;

    if (paymentMethod === "cash" && cashPaidNum < grandTotal) {
      setErrorMsg("Nominal tunai yang diterima kurang dari total tagihan.");
      return;
    }

    setSubmittingOrder(true);
    setErrorMsg(null);

    try {
      const supabase = createClient();

      // Buka shift otomatis jika belum dibuka manual agar transaksi langsung jalan
      let shiftId = activeShift?.id;
      if (!shiftId) {
        const { data: shiftData, error: shiftErr } = await supabase.rpc(
          "open_cashier_shift",
          {
            p_opening_cash: 0,
            p_notes: "Shift otomatis",
          }
        );
        if (shiftErr || !shiftData) {
          throw new Error(shiftErr?.message ?? "Gagal menyiapkan shift kasir.");
        }
        const opened = shiftData as CashierShift;
        setActiveShift(opened);
        shiftId = opened.id;
      }

      const itemsPayload = cart.map((c) => ({
        product_id: c.product.id,
        quantity: c.quantity,
      }));

      const { data, error } = await supabase.rpc("create_pos_order", {
        p_shift_id: shiftId,
        p_order_type: "dine_in",
        p_payment_method: paymentMethod,
        p_discount_amount: discountAmount,
        p_amount_paid: paymentMethod === "cash" ? cashPaidNum : grandTotal,
        p_customer_phone: null,
        p_notes: customerName.trim(),
        p_items: itemsPayload,
      });

      if (error || !data) {
        throw new Error(error?.message ?? "Gagal memproses transaksi POS.");
      }

      const resOrder = data as Order;
      const hydratedOrder: Order = {
        ...resOrder,
        customer_phone: null,
        notes: customerName.trim(),
        items: cart.map((c, idx) => ({
          id: `${resOrder.id}-${idx}`,
          product_id: c.product.id,
          product_name: c.product.name,
          quantity: c.quantity,
          unit_price: c.product.price,
          subtotal: c.product.price * c.quantity,
        })),
      };

      setQrisFullscreen(false);
      setCheckoutOpen(false);
      setCart([]);
      setDiscountInput("0");
      setCompletedOrder(hydratedOrder);
      void broadcastBusinessUpdate(storeConfig.business_id, "orders");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menyimpan pesanan.");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    await submitCheckoutOrder();
  };

  const CartPanelContent = (
    <div className="flex flex-col h-full justify-between gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#1C1917]">
            Keranjang ({totalItems} item)
          </h2>
          {cart.length > 0 ? (
            <button
              type="button"
              onClick={() => setCart([])}
              className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-[#B91C1C] hover:bg-red-50"
            >
              Kosongkan
            </button>
          ) : null}
        </div>

        {/* Cart Items */}
        {cart.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#1C1917]/20 p-5 text-center text-xs text-[#44403C]">
            Ketuk menu di samping untuk menambahkan pesanan pelanggan.
          </div>
        ) : (
          <div className="space-y-2 max-h-[38dvh] overflow-y-auto pr-1">
            {cart.map((entry) => (
              <div
                key={entry.product.id}
                className="rounded-xl border border-[#1C1917]/10 bg-white/85 p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-bold text-[#1C1917] truncate">
                    {entry.product.name}
                  </p>
                  <p className="text-xs text-[#44403C] tabular-nums">
                    {formatRupiah(entry.product.price)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    aria-label={`Kurangi ${entry.product.name}`}
                    onClick={() => updateCartQty(entry.product.id, -1)}
                    className="w-10 h-10 rounded-xl border border-[#1C1917]/15 bg-white inline-flex items-center justify-center text-[#1C1917]"
                  >
                    {entry.quantity === 1 ? (
                      <Trash size={15} weight="bold" className="text-[#B91C1C]" aria-hidden="true" />
                    ) : (
                      <Minus size={15} weight="bold" aria-hidden="true" />
                    )}
                  </button>
                  <span className="w-7 text-center text-sm font-extrabold text-[#1C1917] tabular-nums">
                    {entry.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tambah ${entry.product.name}`}
                    onClick={() => updateCartQty(entry.product.id, 1)}
                    className="w-10 h-10 rounded-xl bg-[#14532D] text-white inline-flex items-center justify-center"
                  >
                    <Plus size={15} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discount & Totals */}
      <div className="space-y-3 pt-3 border-t border-[#1C1917]/10">
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-black/5 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setDiscountMode("rp")}
              className={`min-h-8 rounded-lg px-2.5 text-xs font-bold ${
                discountMode === "rp" ? "bg-white text-[#14532D]" : "text-[#44403C]"
              }`}
            >
              Rp
            </button>
            <button
              type="button"
              onClick={() => setDiscountMode("pct")}
              className={`min-h-8 rounded-lg px-2.5 text-xs font-bold ${
                discountMode === "pct" ? "bg-white text-[#14532D]" : "text-[#44403C]"
              }`}
            >
              %
            </button>
          </div>
          <input
            type="number"
            min="0"
            aria-label="Diskon promo"
            value={discountInput}
            onChange={(e) => setDiscountInput(e.target.value)}
            placeholder="Diskon"
            className="min-h-10 flex-1 rounded-xl border border-[#1C1917]/20 bg-white px-3 text-xs sm:text-sm tabular-nums"
          />
        </div>

        <div className="space-y-1 text-xs sm:text-sm tabular-nums">
          <div className="flex justify-between text-[#44403C]">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          {discountAmount > 0 ? (
            <div className="flex justify-between text-[#B43D0A] font-semibold">
              <span>Diskon Promo</span>
              <span>-{formatRupiah(discountAmount)}</span>
            </div>
          ) : null}
          {serviceAmount > 0 ? (
            <div className="flex justify-between text-[#44403C]">
              <span>Servis ({storeConfig.service_charge_rate}%)</span>
              <span>{formatRupiah(serviceAmount)}</span>
            </div>
          ) : null}
          {taxAmount > 0 ? (
            <div className="flex justify-between text-[#44403C]">
              <span>Pajak ({storeConfig.tax_rate}%)</span>
              <span>{formatRupiah(taxAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base sm:text-lg font-extrabold text-[#1C1917] pt-1.5 border-t border-[#1C1917]/10">
            <span>Total Tagihan</span>
            <span className="text-[#14532D]">{formatRupiah(grandTotal)}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={cart.length === 0}
          onClick={openPaymentModal}
          className="min-h-12 w-full rounded-xl bg-[#B43D0A] px-4 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-[#9A3412] disabled:opacity-45 transition-colors shadow-sm"
        >
          Bayar {formatRupiah(grandTotal)}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {errorMsg ? <ErrorState message={errorMsg} /> : null}

      {/* Shift Info Bar */}
      <div className="glass-panel rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 text-[#14532D] px-2.5 py-1 font-bold">
            <CheckCircle size={15} weight="bold" aria-hidden="true" />
            Kasir Siap Transaksi
          </span>
          <span className="text-[#44403C]">
            Pilih menu dan selesaikan pembayaran pelanggan.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/pos/riwayat"
            className="min-h-10 inline-flex items-center rounded-xl border border-[#1C1917]/15 bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-white"
          >
            Riwayat Transaksi
          </Link>
          {activeShift ? (
            <button
              type="button"
              onClick={openCloseShiftDialog}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#B43D0A]/30 bg-white/80 px-3 py-1.5 text-xs font-bold text-[#B43D0A] hover:bg-orange-50"
            >
              <LockKey size={15} weight="bold" aria-hidden="true" />
              Rekap & Tutup Shift
            </button>
          ) : null}
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Search + Categories + Menu Grid */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-3">
          <div className="glass-panel rounded-2xl p-3 space-y-3">
            <div className="relative">
              <MagnifyingGlass
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#44403C]"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari menu kasir"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu makanan atau minuman..."
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/90 pl-10 pr-4 text-sm text-[#1C1917]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`min-h-10 shrink-0 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors ${
                    category === cat
                      ? "bg-[#14532D] text-white"
                      : "bg-white/80 text-[#1C1917] hover:bg-white"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState
              title="Belum ada menu aktif di kasir"
              description="Tambahkan menu makanan atau minuman di halaman Menu & Resep HPP agar tampil di layar kasir."
              action={
                <Link
                  href="/menu"
                  className="min-h-11 inline-flex items-center rounded-xl bg-[#14532D] px-4 py-2 text-sm font-bold text-white"
                >
                  Kelola Menu
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-16 lg:pb-0">
              {filteredProducts.map((product) => {
                const inCart = cartQtyMap.get(product.id) ?? 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    className={`glass-panel rounded-2xl p-3 text-left flex flex-col justify-between gap-2.5 transition-transform active:scale-[0.98] hover:bg-white/90 ${
                      inCart > 0 ? "ring-2 ring-[#14532D]" : ""
                    }`}
                  >
                    <div className="relative w-full aspect-[4/3] rounded-xl bg-white/80 border border-[#1C1917]/10 overflow-hidden flex items-center justify-center">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 45vw, 220px"
                          className="object-cover"
                        />
                      ) : (
                        <span className="text-lg font-extrabold text-[#14532D]">
                          {product.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {inCart > 0 ? (
                        <span className="absolute top-2 right-2 min-w-7 h-7 rounded-lg bg-[#14532D] px-2 text-xs font-extrabold text-white inline-flex items-center justify-center tabular-nums shadow">
                          {inCart}
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-0.5">
                      <p className="text-[11px] font-medium text-[#44403C]">
                        {product.category}
                      </p>
                      <p className="text-sm font-bold text-[#1C1917] line-clamp-2 leading-snug">
                        {product.name}
                      </p>
                      <p className="text-sm sm:text-base font-extrabold text-[#14532D] tabular-nums pt-0.5">
                        {formatRupiah(product.price)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Persistent Desktop/Tablet Cart */}
        <aside
          aria-label="Keranjang pesanan"
          className="hidden lg:block lg:col-span-5 xl:col-span-4 glass-elevated rounded-2xl p-4 sticky top-24"
        >
          {CartPanelContent}
        </aside>
      </div>

      {/* Mobile Sticky Cart Summary Bar */}
      {totalItems > 0 ? (
        <div className="lg:hidden fixed bottom-20 inset-x-3 z-30">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            className="w-full min-h-14 rounded-2xl bg-[#14532D] text-white px-4 py-3 shadow-lg flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <ShoppingBag size={22} weight="bold" aria-hidden="true" />
              <div className="text-left">
                <p className="text-xs font-medium text-white/85">
                  {totalItems} item
                </p>
                <p className="text-sm font-extrabold tabular-nums">
                  {formatRupiah(grandTotal)}
                </p>
              </div>
            </div>
            <span className="rounded-xl bg-[#B43D0A] px-3.5 py-2 text-xs font-extrabold">
              Lihat & Bayar
            </span>
          </button>
        </div>
      ) : null}

      {/* Mobile Cart Sheet Modal */}
      <Modal
        open={mobileCartOpen}
        onClose={() => setMobileCartOpen(false)}
        title="Rincian Pesanan"
      >
        {CartPanelContent}
      </Modal>

      {/* Checkout / Payment Modal */}
      <Modal
        open={checkoutOpen}
        onClose={() => {
          if (!qrisFullscreen) setCheckoutOpen(false);
        }}
        title="Pembayaran Kasir"
        description={`Total tagihan: ${formatRupiah(grandTotal)}`}
      >
        <form onSubmit={handleCheckout} className="space-y-4">
          {errorMsg ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2 text-xs text-[#B91C1C] flex items-center gap-2"
            >
              <WarningCircle size={16} weight="bold" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: "cash", label: "Tunai", icon: Money },
                { key: "qris", label: "QRIS", icon: QrCode },
                { key: "transfer", label: "Transfer", icon: Bank },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPaymentMethod(key)}
                className={`min-h-12 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors ${
                  paymentMethod === key
                    ? "border-[#14532D] bg-[#14532D] text-white"
                    : "border-[#1C1917]/20 bg-white text-[#1C1917]"
                }`}
              >
                <Icon size={18} weight="bold" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {paymentMethod === "cash" ? (
            <div className="space-y-3 rounded-xl bg-black/5 p-3.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCashPaidInput(String(grandTotal))}
                  className="min-h-9 rounded-lg bg-[#14532D]/15 px-3 text-xs font-bold text-[#14532D]"
                >
                  Uang Pas
                </button>
                {QUICK_CASH_VALUES.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setCashPaidInput(String(val))}
                    className="min-h-9 rounded-lg bg-white border border-[#1C1917]/15 px-3 text-xs font-bold text-[#1C1917] tabular-nums"
                  >
                    {formatRupiah(val)}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <label htmlFor="cashPaid" className="block text-xs font-semibold text-[#1C1917]">
                  Uang Diterima (Rp)
                </label>
                <input
                  id="cashPaid"
                  type="number"
                  min={grandTotal}
                  required
                  value={cashPaidInput}
                  onChange={(e) => setCashPaidInput(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-lg font-extrabold text-[#1C1917] tabular-nums"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-semibold text-[#44403C]">Kembalian</span>
                <span className="text-xl font-extrabold text-[#14532D] tabular-nums">
                  {formatRupiah(changeAmount)}
                </span>
              </div>
            </div>
          ) : paymentMethod === "qris" ? (
            <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 text-center space-y-2.5">
              <p className="text-xs font-semibold text-[#44403C]">
                Tunjukkan QRIS ini kepada pelanggan untuk nominal:
              </p>
              <p className="text-xl font-extrabold text-[#14532D] tabular-nums">
                {formatRupiah(grandTotal)}
              </p>
              {storeConfig.qris_image_url ? (
                <div className="space-y-2.5">
                  <div className="mx-auto w-52 h-52 relative">
                    <Image
                      src={storeConfig.qris_image_url}
                      alt="QRIS Pembayaran Toko"
                      fill
                      sizes="208px"
                      className="object-contain rounded-xl"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setQrisFullscreen(true)}
                    className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-[#14532D]/10 px-3.5 py-2 text-xs font-bold text-[#14532D] hover:bg-[#14532D]/15 transition-colors cursor-pointer"
                  >
                    <ArrowsOutSimple size={15} weight="bold" aria-hidden="true" />
                    <span>Perbesar QRIS (Layar Penuh)</span>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[#B43D0A] bg-[#FEF3C7] rounded-xl p-3">
                  Gambar QRIS toko belum diunggah. Unggah di menu Pengaturan Bisnis agar QR
                  tampil di sini.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-[#1C1917]/15 p-4 space-y-2">
              <p className="text-xs font-semibold text-[#44403C]">
                Transfer tepat sesuai nominal{" "}
                <strong className="text-[#14532D] tabular-nums">
                  {formatRupiah(grandTotal)}
                </strong>
                :
              </p>
              {storeConfig.bank_account_number ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-black/5 p-3">
                  <div>
                    <p className="text-xs font-bold text-[#1C1917]">
                      {storeConfig.bank_name || "Bank"} · {storeConfig.bank_account_holder}
                    </p>
                    <p className="text-base font-extrabold text-[#14532D] tabular-nums">
                      {storeConfig.bank_account_number}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(storeConfig.bank_account_number);
                      setCopiedRek(true);
                      window.setTimeout(() => setCopiedRek(false), 2000);
                    }}
                    className="min-h-10 rounded-xl bg-white border border-[#1C1917]/15 px-3 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Copy size={14} weight="bold" aria-hidden="true" />
                    {copiedRek ? "Disalin" : "Salin"}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[#B43D0A] bg-[#FEF3C7] rounded-xl p-3">
                  Nomor rekening bank belum diisi di Pengaturan Bisnis.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="custName" className="block text-xs font-semibold text-[#1C1917]">
              Nama Pelanggan (Opsional)
            </label>
            <input
              id="custName"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nama pelanggan"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
            />
          </div>

          <button
            type="submit"
            disabled={submittingOrder}
            className="min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
          >
            {submittingOrder ? "Memproses transaksi..." : "Konfirmasi & Selesaikan Pesanan"}
          </button>
        </form>
      </Modal>

      {checkoutOpen && qrisFullscreen && paymentMethod === "qris" && storeConfig.qris_image_url ? (
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
                {storeConfig.business_name}
              </p>
              <p className="text-xs sm:text-sm text-[#44403C]">
                Scan QRIS untuk membayar
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQrisFullscreen(false)}
              aria-label="Tutup tampilan layar penuh QRIS"
              className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-black/5 transition-colors cursor-pointer"
            >
              <X size={16} weight="bold" aria-hidden="true" />
              <span>Tutup</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center py-3 sm:py-4 gap-3 sm:gap-4 max-w-lg w-full mx-auto">
            <div className="text-center space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-[#44403C]">
                Total Pembayaran
              </p>
              <p className="text-3xl sm:text-4xl font-extrabold text-[#14532D] tabular-nums tracking-tight">
                {formatRupiah(grandTotal)}
              </p>
            </div>

            <div
              style={{
                width: "min(84vw, 58dvh, 440px)",
                height: "min(84vw, 58dvh, 440px)",
              }}
              className="rounded-2xl border-2 border-[#1C1917]/15 bg-white p-2.5 sm:p-3 shadow-sm"
            >
              <div className="relative w-full h-full">
                <Image
                  src={storeConfig.qris_image_url}
                  alt={`QRIS ${storeConfig.business_name}`}
                  fill
                  sizes="(max-width: 640px) 84vw, 440px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>

          <div className="max-w-lg w-full mx-auto space-y-2.5 pt-2">
            {errorMsg ? (
              <div
                role="alert"
                className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2 text-xs text-[#B91C1C] flex items-center gap-2"
              >
                <WarningCircle size={16} weight="bold" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setQrisFullscreen(false)}
                className="min-h-12 w-full rounded-xl border border-[#1C1917]/20 bg-white px-4 py-3 text-sm font-semibold text-[#1C1917] hover:bg-black/5 transition-colors cursor-pointer"
              >
                Kembali ke Rincian
              </button>
              <button
                type="button"
                disabled={submittingOrder}
                onClick={() => {
                  void submitCheckoutOrder();
                }}
                className="min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors cursor-pointer"
              >
                {submittingOrder ? "Memproses transaksi..." : "Konfirmasi & Selesaikan Pesanan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Close Shift Modal */}
      <Modal
        open={closeShiftOpen}
        onClose={() => setCloseShiftOpen(false)}
        title="Tutup Kasir & Rekap Shift"
        description="Hitung uang fisik di laci kasir untuk pencocokan akhir shift."
      >
        {!shiftSummary ? (
          <p className="text-sm text-[#44403C] py-4">Memuat rekap shift...</p>
        ) : (
          <form onSubmit={handleCloseShift} className="space-y-4">
            <div className="rounded-xl bg-black/5 p-3.5 space-y-1.5 text-xs sm:text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-[#44403C]">Jumlah Transaksi</span>
                <span className="font-bold">{shiftSummary.order_count} pesanan</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#44403C]">Modal Awal Kasir</span>
                <span className="font-bold">{formatRupiah(shiftSummary.opening_cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#44403C]">Penjualan Tunai</span>
                <span className="font-bold">{formatRupiah(shiftSummary.cash_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#44403C]">Penjualan QRIS</span>
                <span className="font-bold">{formatRupiah(shiftSummary.qris_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#44403C]">Penjualan Transfer</span>
                <span className="font-bold">{formatRupiah(shiftSummary.transfer_sales)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#1C1917]/15 text-sm font-extrabold text-[#14532D]">
                <span>Ekspektasi Uang Tunai Laci</span>
                <span>{formatRupiah(shiftSummary.expected_cash)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="actualCash" className="block text-sm font-semibold text-[#1C1917]">
                Total Uang Fisik yang Dihitung (Rp)
              </label>
              <input
                id="actualCash"
                type="number"
                min="0"
                required
                value={actualCashInput}
                onChange={(e) => setActualCashInput(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-lg font-extrabold text-[#1C1917] tabular-nums"
              />
              <p className="text-xs font-semibold tabular-nums">
                Selisih kas:{" "}
                <span
                  className={
                    (Number(actualCashInput) || 0) - shiftSummary.expected_cash === 0
                      ? "text-[#14532D]"
                      : "text-[#B43D0A]"
                  }
                >
                  {formatRupiah(
                    (Number(actualCashInput) || 0) - shiftSummary.expected_cash
                  )}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="closeNotes" className="block text-sm font-semibold text-[#1C1917]">
                Catatan Tutup Kasir (Opsional)
              </label>
              <input
                id="closeNotes"
                type="text"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Keterangan selisih atau serah terima"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseShiftOpen(false)}
                className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={closingLoading}
                className="min-h-11 rounded-xl bg-[#B43D0A] px-5 text-sm font-bold text-white hover:bg-[#9A3412]"
              >
                {closingLoading ? "Menutup shift..." : "Simpan & Tutup Kasir"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Post-Order Receipt Modal */}
      <ReceiptModal
        order={completedOrder}
        store={storeConfig}
        onClose={() => setCompletedOrder(null)}
      />
    </div>
  );
}

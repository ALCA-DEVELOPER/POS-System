"use client";

import { useEffect, useState } from "react";
import {
  Bluetooth,
  CheckCircle,
  Copy,
  DownloadSimple,
  ImageSquare,
  Printer,
  ShareNetwork,
  WhatsappLogo,
} from "@phosphor-icons/react";
import {
  formatDateId,
  formatRupiah,
  PAYMENT_METHOD_LABELS,
} from "@/lib/format";
import {
  buildEscPosReceipt,
  buildWhatsAppReceiptText,
  getWhatsAppShareUrl,
  printViaBluetoothThermal,
} from "@/lib/printer/escpos";
import { renderReceiptToImageBlob } from "@/lib/printer/receipt-image";
import type { Order, StorePosConfig } from "@/types/database";
import { Modal } from "@/components/ui/Modal";

interface ReceiptModalProps {
  order: Order | null;
  store: StorePosConfig;
  onClose: () => void;
}

export function ReceiptModal({ order, store, onClose }: ReceiptModalProps) {
  const [paperWidth, setPaperWidth] = useState<58 | 80>(58);
  const [waPhone, setWaPhone] = useState(order?.customer_phone ?? "");
  const [printingBt, setPrintingBt] = useState(false);
  const [exportingImg, setExportingImg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setWaPhone(order?.customer_phone ?? "");
    setStatusMsg(null);
    setErrorMsg(null);
  }, [order]);

  if (!order) return null;

  const receiptText = buildWhatsAppReceiptText(order, store);
  const effectivePhone = waPhone || order.customer_phone || "";

  const handleBluetoothPrint = async () => {
    setPrintingBt(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const bytes = buildEscPosReceipt(order, store, paperWidth);
      const deviceName = await printViaBluetoothThermal(bytes);
      setStatusMsg(`Struk berhasil dikirim ke ${deviceName} (${paperWidth}mm).`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal terhubung ke printer Bluetooth."
      );
    } finally {
      setPrintingBt(false);
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg("Browser memblokir salin otomatis. Salin manual teks struk.");
    }
  };

  const handleDownloadImage = async (format: "png" | "webp") => {
    setExportingImg(format);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const { blob, actualFormat } = await renderReceiptToImageBlob(
        order,
        store,
        format
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Struk-${order.order_number}.${actualFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusMsg(
        `Gambar struk ${actualFormat.toUpperCase()} siap disimpan dan dikirim.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal mengekspor gambar struk."
      );
    } finally {
      setExportingImg(null);
    }
  };

  const handleShareOrCopyImage = async () => {
    setExportingImg("share");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const { blob } = await renderReceiptToImageBlob(order, store, "png");
      const file = new File([blob], `Struk-${order.order_number}.png`, {
        type: "image/png",
      });

      if (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: `Struk ${order.order_number}`,
        });
        setStatusMsg("Gambar struk dibagikan.");
        return;
      }

      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof ClipboardItem !== "undefined"
      ) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setStatusMsg(
          "Gambar struk PNG disalin ke clipboard (bisa langsung tempel/paste di WhatsApp Web)."
        );
        return;
      }

      await handleDownloadImage("png");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal membagikan gambar struk."
      );
    } finally {
      setExportingImg(null);
    }
  };

  const extraChargeLabel = order.order_type === "online" ? "Ongkir" : "Servis";
  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const isUnpaidOnline =
    order.order_type === "online" && Number(order.amount_paid) === 0;

  return (
    <Modal
      open={Boolean(order)}
      onClose={onClose}
      title={`Struk ${order.order_number}`}
      description="Cetak ke printer thermal Bluetooth, simpan PDF/print browser, atau kirim via WhatsApp."
    >
      <div className="space-y-4">
        {/* Visual Thermal Receipt Preview (also printable) */}
        <div className="receipt-print-sheet mx-auto max-w-[300px] rounded-xl border border-dashed border-[#1C1917]/30 bg-white p-4 text-xs text-[#1C1917] space-y-2 shadow-xs">
          <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-[#1C1917]/25">
            <p className="text-sm font-extrabold uppercase">
              {store.business_name || "KulinerKas"}
            </p>
            {store.address ? <p className="text-[11px] text-[#44403C]">{store.address}</p> : null}
            {store.phone ? <p className="text-[11px] text-[#44403C]">WA: {store.phone}</p> : null}
          </div>

          <div className="space-y-0.5 text-[11px] text-[#44403C] pb-2 border-b border-dashed border-[#1C1917]/25">
            <p>No: {order.order_number}</p>
            <p>Waktu: {formatDateId(order.created_at, true)}</p>
            {order.notes ? (
              <p className="font-semibold text-[#1C1917]">Pelanggan: {order.notes}</p>
            ) : null}
          </div>

          <div className="space-y-1.5 pb-2 border-b border-dashed border-[#1C1917]/25">
            {(order.items ?? []).map((it) => (
              <div key={it.id} className="space-y-0.5">
                <p className="font-semibold text-[#1C1917]">{it.product_name}</p>
                <div className="flex justify-between text-[#44403C] tabular-nums">
                  <span>
                    {it.quantity} x {formatRupiah(it.unit_price)}
                  </span>
                  <span className="font-semibold text-[#1C1917]">
                    {formatRupiah(it.subtotal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1 tabular-nums">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatRupiah(order.subtotal)}</span>
            </div>
            {Number(order.discount_amount) > 0 ? (
              <div className="flex justify-between text-[#B43D0A]">
                <span>Diskon</span>
                <span>-{formatRupiah(order.discount_amount)}</span>
              </div>
            ) : null}
            {Number(order.service_amount) > 0 ? (
              <div className="flex justify-between">
                <span>{extraChargeLabel}</span>
                <span>{formatRupiah(order.service_amount)}</span>
              </div>
            ) : null}
            {Number(order.tax_amount) > 0 ? (
              <div className="flex justify-between">
                <span>Pajak</span>
                <span>{formatRupiah(order.tax_amount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm font-extrabold pt-1 border-t border-dashed border-[#1C1917]/25">
              <span>TOTAL</span>
              <span>{formatRupiah(order.total_amount)}</span>
            </div>
            <div className="flex justify-between text-[#44403C]">
              <span>Bayar ({paymentLabel})</span>
              <span>
                {isUnpaidOnline ? "Menunggu Validasi" : formatRupiah(order.amount_paid)}
              </span>
            </div>
            {order.payment_method === "cash" ? (
              <div className="flex justify-between font-bold text-[#14532D]">
                <span>Kembali</span>
                <span>{formatRupiah(order.change_amount)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {statusMsg ? (
          <div
            role="status"
            className="rounded-xl bg-emerald-50 border border-[#14532D]/30 px-3 py-2 text-xs font-semibold text-[#14532D] flex items-center gap-2"
          >
            <CheckCircle size={16} weight="bold" aria-hidden="true" />
            <span>{statusMsg}</span>
          </div>
        ) : null}

        {errorMsg ? (
          <div
            role="alert"
            className="rounded-xl bg-red-50 border border-[#B91C1C]/30 px-3 py-2 text-xs font-medium text-[#B91C1C]"
          >
            {errorMsg}
          </div>
        ) : null}

        {/* Thermal Bluetooth Controls */}
        <div className="no-print space-y-2.5 rounded-xl bg-black/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#1C1917]">Ukuran Kertas Thermal</span>
            <div className="flex gap-1.5">
              {([58, 80] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPaperWidth(w)}
                  className={`min-h-8 rounded-lg px-2.5 text-xs font-bold ${
                    paperWidth === w
                      ? "bg-[#14532D] text-white"
                      : "bg-white text-[#1C1917]"
                  }`}
                >
                  {w}mm
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleBluetoothPrint}
              disabled={printingBt}
              className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-3 py-2 text-xs font-bold text-white hover:bg-[#166534] disabled:opacity-60"
            >
              <Bluetooth size={17} weight="bold" aria-hidden="true" />
              {printingBt ? "Menghubungkan..." : `Print Bluetooth ${paperWidth}mm`}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white px-3 py-2 text-xs font-bold text-[#1C1917] hover:bg-black/5 cursor-pointer"
            >
              <Printer size={17} weight="bold" aria-hidden="true" />
              Cetak Browser / PDF
            </button>
          </div>
        </div>

        {/* Export Receipt Image (PNG / WebP / Share) */}
        <div className="no-print space-y-2 rounded-xl border border-[#14532D]/20 bg-emerald-50/55 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#14532D]">
            <ImageSquare size={16} weight="duotone" aria-hidden="true" />
            <span>Ekspor Gambar Struk (Langsung Kirim WA)</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={Boolean(exportingImg)}
              onClick={() => {
                void handleDownloadImage("png");
              }}
              className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-[#14532D]/30 px-2.5 py-2 text-xs font-bold text-[#14532D] hover:bg-emerald-50 disabled:opacity-60 cursor-pointer"
            >
              <DownloadSimple size={15} weight="bold" aria-hidden="true" />
              {exportingImg === "png" ? "..." : "PNG"}
            </button>

            <button
              type="button"
              disabled={Boolean(exportingImg)}
              onClick={() => {
                void handleDownloadImage("webp");
              }}
              className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-[#14532D]/30 px-2.5 py-2 text-xs font-bold text-[#14532D] hover:bg-emerald-50 disabled:opacity-60 cursor-pointer"
            >
              <DownloadSimple size={15} weight="bold" aria-hidden="true" />
              {exportingImg === "webp" ? "..." : "WebP"}
            </button>

            <button
              type="button"
              disabled={Boolean(exportingImg)}
              onClick={() => {
                void handleShareOrCopyImage();
              }}
              className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#14532D] px-2.5 py-2 text-xs font-bold text-white hover:bg-[#166534] disabled:opacity-60 cursor-pointer"
            >
              <ShareNetwork size={15} weight="bold" aria-hidden="true" />
              {exportingImg === "share" ? "..." : "Kirim / Salin"}
            </button>
          </div>
        </div>

        {/* WhatsApp Share */}
        <div className="no-print space-y-2">
          <label htmlFor="waCustomer" className="block text-xs font-semibold text-[#1C1917]">
            Kirim Struk Digital via WhatsApp
          </label>
          <div className="flex gap-2">
            <input
              id="waCustomer"
              type="tel"
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
              placeholder="No. WA pelanggan (opsional, misal 0812xxx)"
              className="min-h-11 flex-1 rounded-xl border border-[#1C1917]/20 bg-white px-3 text-xs sm:text-sm text-[#1C1917]"
            />
            <button
              type="button"
              onClick={handleCopyText}
              aria-label="Salin teks struk"
              className="min-h-11 min-w-11 rounded-xl border border-[#1C1917]/20 bg-white inline-flex items-center justify-center text-[#1C1917]"
              title="Salin teks struk"
            >
              <Copy size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          {copied ? (
            <p className="text-[11px] font-semibold text-[#14532D]">
              Teks struk disalin ke clipboard.
            </p>
          ) : null}

          <a
            href={getWhatsAppShareUrl(receiptText, effectivePhone)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#15803D] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
          >
            <WhatsappLogo size={20} weight="fill" aria-hidden="true" />
            Kirim Struk ke WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}

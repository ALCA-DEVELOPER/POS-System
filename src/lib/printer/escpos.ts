import {
  formatDateId,
  formatRupiah,
  normalizeWhatsAppPhone,
  PAYMENT_METHOD_LABELS,
} from "@/lib/format";
import type { Order, StorePosConfig } from "@/types/database";

const THERMAL_SERVICE_UUIDS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
];

function padLine(left: string, right: string, width: number): string {
  const cleanLeft = left.slice(0, Math.max(1, width - right.length - 1));
  const spaces = Math.max(1, width - cleanLeft.length - right.length);
  return `${cleanLeft}${" ".repeat(spaces)}${right}`;
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return `${" ".repeat(pad)}${text}`;
}

/** Susun byte array perintah ESC/POS untuk printer thermal 58mm atau 80mm. */
export function buildEscPosReceipt(
  order: Order,
  store: StorePosConfig,
  paperWidth: 58 | 80 = 58
): Uint8Array {
  const cols = paperWidth === 80 ? 48 : 32;
  const divider = "-".repeat(cols);
  const lines: string[] = [];

  lines.push(centerText((store.business_name || "KulinerKas").toUpperCase(), cols));
  if (store.address) lines.push(centerText(store.address, cols));
  if (store.phone) lines.push(centerText(`WA: ${store.phone}`, cols));
  lines.push(divider);
  lines.push(`No   : ${order.order_number}`);
  lines.push(`Tgl  : ${formatDateId(order.created_at, true)}`);
  if (order.notes) {
    lines.push(`Nama : ${order.notes}`);
  }
  lines.push(divider);

  for (const item of order.items ?? []) {
    lines.push(item.product_name.slice(0, cols));
    const qtyPrice = `  ${item.quantity}x ${formatRupiah(item.unit_price)}`;
    lines.push(padLine(qtyPrice, formatRupiah(item.subtotal), cols));
  }

  const serviceLabel = order.order_type === "online" ? "Ongkir" : "Servis";
  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const isUnpaidOnline =
    order.order_type === "online" && Number(order.amount_paid) === 0;

  lines.push(divider);
  lines.push(padLine("Subtotal", formatRupiah(order.subtotal), cols));
  if (Number(order.discount_amount) > 0) {
    lines.push(padLine("Diskon", `-${formatRupiah(order.discount_amount)}`, cols));
  }
  if (Number(order.service_amount) > 0) {
    lines.push(padLine(serviceLabel, formatRupiah(order.service_amount), cols));
  }
  if (Number(order.tax_amount) > 0) {
    lines.push(padLine("Pajak", formatRupiah(order.tax_amount), cols));
  }
  lines.push(padLine("TOTAL", formatRupiah(order.total_amount), cols));
  lines.push(
    padLine(
      `Bayar (${paymentLabel})`,
      isUnpaidOnline ? "Belum Lunas" : formatRupiah(order.amount_paid),
      cols
    )
  );
  if (order.payment_method === "cash") {
    lines.push(padLine("Kembali", formatRupiah(order.change_amount), cols));
  }
  lines.push(divider);
  lines.push(centerText("Terima kasih atas kunjungan Anda", cols));
  lines.push("\n\n\n");

  const encoder = new TextEncoder();
  const initCmd = new Uint8Array([0x1b, 0x40]); // ESC @ Reset
  const bodyBytes = encoder.encode(lines.join("\n"));
  const cutCmd = new Uint8Array([0x1d, 0x56, 0x42, 0x00]); // GS V B 0 Feed & Cut

  const output = new Uint8Array(initCmd.length + bodyBytes.length + cutCmd.length);
  output.set(initCmd, 0);
  output.set(bodyBytes, initCmd.length);
  output.set(cutCmd, initCmd.length + bodyBytes.length);
  return output;
}

/** Cetak struk langsung ke printer thermal Bluetooth via Web Bluetooth API. */
export async function printViaBluetoothThermal(
  payload: Uint8Array
): Promise<string> {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
    throw new Error(
      "Browser ini belum mendukung Web Bluetooth (gunakan Chrome Android/Desktop, atau pilih Cetak Browser / Kirim WhatsApp)."
    );
  }

  const bt = (
    navigator as Navigator & {
      bluetooth: {
        requestDevice: (options: {
          acceptAllDevices?: boolean;
          optionalServices?: string[];
        }) => Promise<{
          name?: string;
          gatt?: {
            connect: () => Promise<{
              getPrimaryServices: () => Promise<
                Array<{
                  getCharacteristics: () => Promise<
                    Array<{
                      properties: { write: boolean; writeWithoutResponse: boolean };
                      writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
                      writeValue: (v: BufferSource) => Promise<void>;
                    }>
                  >;
                }>
              >;
            }>;
          };
        }>;
      };
    }
  ).bluetooth;

  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: THERMAL_SERVICE_UUIDS,
  });

  if (!device.gatt) {
    throw new Error("Perangkat Bluetooth tidak mendukung koneksi GATT.");
  }

  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();

  let writableChar: {
    properties: { write: boolean; writeWithoutResponse: boolean };
    writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
    writeValue: (v: BufferSource) => Promise<void>;
  } | null = null;

  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) {
        writableChar = ch;
        break;
      }
    }
    if (writableChar) break;
  }

  if (!writableChar) {
    throw new Error("Karakteristik tulis printer thermal tidak ditemukan.");
  }

  const chunkSize = 100;
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const chunk = payload.slice(offset, offset + chunkSize);
    if (
      writableChar.properties.writeWithoutResponse &&
      writableChar.writeValueWithoutResponse
    ) {
      await writableChar.writeValueWithoutResponse(chunk);
    } else {
      await writableChar.writeValue(chunk);
    }
  }

  return device.name || "Printer Thermal Bluetooth";
}

/** Susun teks struk digital yang rapi untuk dikirim via WhatsApp. */
export function buildWhatsAppReceiptText(order: Order, store: StorePosConfig): string {
  const lines: string[] = [];
  lines.push(`*${store.business_name || "KulinerKas"}*`);
  if (store.address) lines.push(store.address);
  lines.push("------------------------");
  lines.push(`No. Struk: ${order.order_number}`);
  lines.push(`Waktu: ${formatDateId(order.created_at, true)}`);
  if (order.notes) lines.push(`Pelanggan: ${order.notes}`);
  lines.push("------------------------");

  for (const item of order.items ?? []) {
    lines.push(
      `${item.product_name} (${item.quantity}x ${formatRupiah(item.unit_price)}) = ${formatRupiah(item.subtotal)}`
    );
  }

  const serviceLabel = order.order_type === "online" ? "Ongkir" : "Servis";
  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const isUnpaidOnline =
    order.order_type === "online" && Number(order.amount_paid) === 0;

  lines.push("------------------------");
  lines.push(`Subtotal: ${formatRupiah(order.subtotal)}`);
  if (Number(order.discount_amount) > 0) {
    lines.push(`Diskon: -${formatRupiah(order.discount_amount)}`);
  }
  if (Number(order.service_amount) > 0) {
    lines.push(`${serviceLabel}: ${formatRupiah(order.service_amount)}`);
  }
  if (Number(order.tax_amount) > 0) {
    lines.push(`Pajak: ${formatRupiah(order.tax_amount)}`);
  }
  lines.push(`*TOTAL: ${formatRupiah(order.total_amount)}*`);
  lines.push(
    isUnpaidOnline
      ? `Bayar (${paymentLabel}): Menunggu Validasi`
      : `Bayar (${paymentLabel}): ${formatRupiah(order.amount_paid)}`
  );
  if (order.payment_method === "cash") {
    lines.push(`Kembali: ${formatRupiah(order.change_amount)}`);
  }
  lines.push("------------------------");
  lines.push("Terima kasih sudah berbelanja!");

  return lines.join("\n");
}

export function getWhatsAppShareUrl(text: string, phone?: string | null): string {
  const normalized = phone ? normalizeWhatsAppPhone(phone) : "";
  const encoded = encodeURIComponent(text);
  return normalized
    ? `https://wa.me/${normalized}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

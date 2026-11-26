const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function formatThousandsId(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Format nominal ke mata uang Rupiah (contoh: Rp 25.000).
 * Menggunakan pemformatan deterministik agar identik antara SSR Node.js dan Safari/WebKit.
 */
export function formatRupiah(amount: number | string | null | undefined): string {
  const num = Math.round(Number(amount ?? 0));
  if (!Number.isFinite(num)) return "Rp 0";
  const formatted = formatThousandsId(String(Math.abs(num)));
  return num < 0 ? `-Rp ${formatted}` : `Rp ${formatted}`;
}

/** Format angka stok/kuantitas dengan pemisah ribuan Indonesia secara deterministik. */
export function formatNumber(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round(num * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const [intPart, fracPart] = Math.abs(rounded).toString().split(".");
  const formattedInt = formatThousandsId(intPart ?? "0");
  return fracPart ? `${sign}${formattedInt},${fracPart}` : `${sign}${formattedInt}`;
}

/** Konversi timestamp ke tanggal/jam WIB (UTC+7) secara deterministik. */
function toWibParts(date: Date) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: wib.getUTCFullYear(),
    monthIdx: wib.getUTCMonth(),
    day: String(wib.getUTCDate()).padStart(2, "0"),
    hour: String(wib.getUTCHours()).padStart(2, "0"),
    minute: String(wib.getUTCMinutes()).padStart(2, "0"),
  };
}

/** Format tanggal ke zona waktu Asia/Jakarta (WIB). */
export function formatDateId(
  dateInput: string | Date,
  withTime = false
): string {
  const date =
    typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
      ? new Date(`${dateInput}T00:00:00+07:00`)
      : typeof dateInput === "string"
        ? new Date(dateInput)
        : dateInput;

  if (Number.isNaN(date.getTime())) return "-";
  const p = toWibParts(date);
  const base = `${p.day} ${MONTHS_ID[p.monthIdx] ?? ""} ${p.year}`;
  return withTime ? `${base}, ${p.hour}.${p.minute}` : base;
}

/** Normalisasi nomor HP Indonesia menjadi format internasional 628xxx untuk link WhatsApp. */
export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Makan di Tempat",
  takeaway: "Bungkus / Takeaway",
  online: "Pesanan Web",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  transfer: "Transfer Bank",
};

export type CustomerOrderDirectMethod = "qris" | "transfer";

const TRANSFER_NOTE_PREFIX = "[Transfer Bank]";

/**
 * Menentukan metode pembayaran aktual order web, mendukung catatan penanda fallback
 * bila kolom payment_method database masih memakai constraint lama sebelum migrasi 005.
 */
export function resolveCustomerOrderPaymentMethod(order: {
  payment_method?: string | null;
  notes?: string | null;
}): CustomerOrderDirectMethod {
  if (order.payment_method === "transfer") {
    return "transfer";
  }
  if ((order.notes ?? "").trim().startsWith(TRANSFER_NOTE_PREFIX)) {
    return "transfer";
  }
  return "qris";
}

export function getCustomerPaymentMethodLabel(
  method: CustomerOrderDirectMethod
): string {
  return method === "transfer" ? "Transfer Bank" : "QRIS";
}

export function buildTransferFallbackNotes(rawNotes: string): string {
  const clean = rawNotes.trim();
  if (!clean) return TRANSFER_NOTE_PREFIX;
  if (clean.startsWith(TRANSFER_NOTE_PREFIX)) return clean;
  return `${TRANSFER_NOTE_PREFIX} ${clean}`;
}

export function stripInternalPaymentTag(notes?: string | null): string {
  const raw = (notes ?? "").trim();
  if (!raw.startsWith(TRANSFER_NOTE_PREFIX)) return raw;
  return raw.slice(TRANSFER_NOTE_PREFIX.length).trim();
}

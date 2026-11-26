export type CustomerOrderDirectMethod = "qris" | "transfer";
export type CustomerOrderDeliveryMethod = "pickup" | "delivery";

const TRANSFER_NOTE_PREFIX = "[Transfer Bank]";
const META_NOTE_PREFIX = "[META:";

interface FallbackOrderMeta {
  pm?: CustomerOrderDirectMethod;
  dt?: CustomerOrderDeliveryMethod;
  df?: number;
  da?: string;
}

function parseFallbackMeta(notes?: string | null): FallbackOrderMeta | null {
  const raw = (notes ?? "").trim();
  if (!raw.startsWith(META_NOTE_PREFIX)) return null;
  const endIdx = raw.indexOf("]");
  if (endIdx === -1) return null;
  try {
    return JSON.parse(raw.slice(META_NOTE_PREFIX.length, endIdx)) as FallbackOrderMeta;
  } catch {
    return null;
  }
}

/**
 * Menentukan metode pembayaran aktual order web, mendukung catatan penanda fallback
 * bila kolom database masih memakai skema lama.
 */
export function resolveCustomerOrderPaymentMethod(order: {
  payment_method?: string | null;
  notes?: string | null;
}): CustomerOrderDirectMethod {
  if (order.payment_method === "transfer") {
    return "transfer";
  }
  const meta = parseFallbackMeta(order.notes);
  if (meta?.pm === "transfer") {
    return "transfer";
  }
  if ((order.notes ?? "").trim().startsWith(TRANSFER_NOTE_PREFIX)) {
    return "transfer";
  }
  return "qris";
}

/**
 * Menentukan tipe pengambilan (COD / Ambil vs Diantar ke Kos + ongkir + alamat)
 * secara aman meski kolom baru di Supabase belum dimigrasi.
 */
export function resolveCustomerOrderDelivery(order: {
  delivery_type?: string | null;
  delivery_fee?: number | string | null;
  delivery_address?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
  notes?: string | null;
}): {
  delivery_type: CustomerOrderDeliveryMethod;
  delivery_fee: number;
  delivery_address: string;
} {
  const meta = parseFallbackMeta(order.notes);
  if (order.delivery_type === "delivery") {
    return {
      delivery_type: "delivery",
      delivery_fee: Math.max(0, Number(order.delivery_fee || 0)),
      delivery_address: (order.delivery_address ?? "").trim(),
    };
  }
  if (meta?.dt === "delivery") {
    return {
      delivery_type: "delivery",
      delivery_fee: Math.max(0, Number(meta.df ?? 0)),
      delivery_address: (meta.da ?? "").trim(),
    };
  }
  const computedDiff =
    Number(order.total_amount || 0) -
    Number(order.quantity || 0) * Number(order.unit_price || 0);
  if (order.delivery_type !== "pickup" && computedDiff > 0) {
    return {
      delivery_type: "delivery",
      delivery_fee: computedDiff,
      delivery_address: (order.delivery_address ?? "").trim(),
    };
  }
  return {
    delivery_type: "pickup",
    delivery_fee: 0,
    delivery_address: "",
  };
}

export function getCustomerPaymentMethodLabel(
  method: CustomerOrderDirectMethod
): string {
  return method === "transfer" ? "Transfer Bank" : "QRIS";
}

export function buildFallbackOrderMetaNotes(params: {
  rawNotes: string;
  paymentMethod?: CustomerOrderDirectMethod;
  deliveryType?: CustomerOrderDeliveryMethod;
  deliveryFee?: number;
  deliveryAddress?: string;
}): string {
  const clean = params.rawNotes.trim();
  const meta: FallbackOrderMeta = {};
  if (params.paymentMethod === "transfer") meta.pm = "transfer";
  if (params.deliveryType === "delivery") {
    meta.dt = "delivery";
    meta.df = Math.max(0, Number(params.deliveryFee || 0));
    meta.da = (params.deliveryAddress ?? "").trim();
  }
  if (!meta.pm && !meta.dt) return clean;
  const serialized = `${META_NOTE_PREFIX}${JSON.stringify(meta)}]`;
  return clean ? `${serialized} ${clean}` : serialized;
}

export function stripInternalPaymentTag(notes?: string | null): string {
  const raw = (notes ?? "").trim();
  if (raw.startsWith(META_NOTE_PREFIX)) {
    const endIdx = raw.indexOf("]");
    if (endIdx !== -1) {
      return raw.slice(endIdx + 1).trim();
    }
  }
  if (raw.startsWith(TRANSFER_NOTE_PREFIX)) {
    return raw.slice(TRANSFER_NOTE_PREFIX.length).trim();
  }
  return raw;
}

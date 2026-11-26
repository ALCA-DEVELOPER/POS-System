"use client";

import { createClient } from "@/lib/supabase/client";

export type BusinessSyncScope =
  | "capital"
  | "orders"
  | "customer_orders"
  | "expenses"
  | "stock"
  | "menu"
  | "settings"
  | "all";

export const BUSINESS_SYNC_DOM_EVENT = "kulinerkas:business-sync";

export function getBusinessRealtimeChannelName(businessId: string): string {
  return `kulinerkas-biz-${businessId}`;
}

export function getPublicOrderChannelName(orderId: string): string {
  return `kulinerkas-pub-order-${orderId}`;
}

export function emitLocalBusinessSync(
  scope: BusinessSyncScope = "all",
  meta?: {
    logoUrl?: string | null;
    businessName?: string;
    pendingOrdersCount?: number;
  }
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BUSINESS_SYNC_DOM_EVENT, {
      detail: { scope, at: Date.now(), ...meta },
    })
  );
}

/**
 * Mengirim sinyal pembaruan real-time ke seluruh perangkat/akun lain dalam bisnis yang sama
 * melalui Supabase Realtime REST Broadcast tanpa memerlukan konfigurasi publikasi tabel manual.
 */
export async function broadcastBusinessUpdate(
  businessId: string | null | undefined,
  scope: BusinessSyncScope
): Promise<void> {
  if (!businessId || typeof window === "undefined") return;
  try {
    const supabase = createClient();
    const channel = supabase.channel(getBusinessRealtimeChannelName(businessId));
    await channel.httpSend("sync", { scope, at: Date.now() });
    await supabase.removeChannel(channel);
  } catch {
    // Sinkronisasi berkala dan fokus tab tetap menjaga konsistensi data jika jaringan tidak stabil.
  }
}

/** Mengirim sinyal real-time ke halaman pelacakan status pembeli untuk order tertentu. */
export async function broadcastPublicOrderUpdate(
  orderId: string | null | undefined
): Promise<void> {
  if (!orderId || typeof window === "undefined") return;
  try {
    const supabase = createClient();
    const channel = supabase.channel(getPublicOrderChannelName(orderId));
    await channel.httpSend("order_update", { orderId, at: Date.now() });
    await supabase.removeChannel(channel);
  } catch {
    // Polling ringan di halaman pembeli tetap memperbarui status.
  }
}

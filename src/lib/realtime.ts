"use client";

import { createClient } from "@/lib/supabase/client";

export type BusinessSyncScope =
  | "capital"
  | "orders"
  | "expenses"
  | "stock"
  | "menu"
  | "settings"
  | "all";

export const BUSINESS_SYNC_DOM_EVENT = "kulinerkas:business-sync";

export function getBusinessRealtimeChannelName(businessId: string): string {
  return `kulinerkas-biz-${businessId}`;
}

export function emitLocalBusinessSync(scope: BusinessSyncScope = "all") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BUSINESS_SYNC_DOM_EVENT, {
      detail: { scope, at: Date.now() },
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

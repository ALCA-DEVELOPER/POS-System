"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import {
  emitLocalBusinessSync,
  getBusinessRealtimeChannelName,
  type BusinessSyncScope,
} from "@/lib/realtime";

interface BusinessRealtimeSyncProps {
  businessId?: string;
}

/**
 * Listener real-time lintas akun/perangkat dalam satu bisnis:
 * - Supabase Broadcast channel (langsung saat akun lain menyimpan transaksi/modal)
 * - Supabase Postgres Changes (jika publikasi supabase_realtime aktif)
 * - Refresh otomatis saat kembali ke tab/aplikasi atau setiap 15 detik saat tab aktif
 */
export function BusinessRealtimeSync({ businessId: propBusinessId }: BusinessRealtimeSyncProps) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(propBusinessId ?? null);
  const [syncing, setSyncing] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (propBusinessId) {
      setBusinessId(propBusinessId);
      return;
    }

    let cancelled = false;
    const resolveBusinessId = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("business_id")
          .eq("id", user.id)
          .maybeSingle();

        if (!cancelled && profile?.business_id) {
          setBusinessId(profile.business_id);
        }
      } catch {
        // Biarkan halaman tetap berjalan normal meski metadata belum dimuat
      }
    };

    void resolveBusinessId();
    return () => {
      cancelled = true;
    };
  }, [propBusinessId]);

  const triggerRefresh = useCallback(
    (scope: BusinessSyncScope = "all", immediate = false) => {
      const run = () => {
        setSyncing(true);
        emitLocalBusinessSync(scope);
        router.refresh();
        window.setTimeout(() => setSyncing(false), 600);
      };

      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }

      if (immediate) {
        run();
      } else {
        debounceTimerRef.current = window.setTimeout(run, 300);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!businessId) return;

    const supabase = createClient();
    const filter = `user_id=eq.${businessId}`;
    const channel = supabase
      .channel(getBusinessRealtimeChannelName(businessId))
      .on("broadcast", { event: "sync" }, (msg) => {
        const payload = msg.payload as { scope?: BusinessSyncScope } | undefined;
        triggerRefresh(payload?.scope ?? "all");
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "capital_entries", filter },
        () => triggerRefresh("capital")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter },
        () => triggerRefresh("orders")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter },
        () => triggerRefresh("expenses")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ingredients", filter },
        () => triggerRefresh("stock")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", filter },
        () => triggerRefresh("menu")
      )
      .subscribe();

    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh("all");
      }
    };

    window.addEventListener("focus", onFocusOrVisible);
    window.addEventListener("online", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        triggerRefresh("all");
      }
    }, 15000);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      window.removeEventListener("focus", onFocusOrVisible);
      window.removeEventListener("online", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [businessId, triggerRefresh]);

  return (
    <button
      type="button"
      onClick={() => triggerRefresh("all", true)}
      aria-label="Sinkronkan data bisnis sekarang"
      title="Sinkronkan data keuangan & stok terbaru"
      className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#1C1917]/15 bg-white/80 px-2.5 sm:px-3 text-xs font-semibold text-[#1C1917] hover:bg-white transition-colors cursor-pointer"
    >
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full bg-[#14532D] shrink-0"
      />
      <ArrowsClockwise
        size={15}
        weight="bold"
        aria-hidden="true"
        className={syncing ? "animate-spin text-[#14532D]" : "text-[#44403C]"}
      />
      <span className="hidden sm:inline">
        {syncing ? "Sinkron..." : "Live Sync"}
      </span>
    </button>
  );
}

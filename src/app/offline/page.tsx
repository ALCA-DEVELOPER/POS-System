"use client";

import Link from "next/link";
import { WifiSlash, ArrowClockwise, Storefront } from "@phosphor-icons/react";

/** Halaman fallback saat perangkat sedang offline dan halaman belum tersimpan di cache. */
export default function OfflinePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="glass-elevated max-w-md w-full rounded-2xl p-6 sm:p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FEF3C7] text-[#92400E] flex items-center justify-center">
          <WifiSlash size={28} weight="duotone" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-[#1C1917]">
            Koneksi Internet Terputus
          </h1>
          <p className="text-sm text-[#44403C] leading-relaxed">
            Halaman ini memerlukan koneksi internet untuk mengambil data terbaru dari
            server. Periksa jaringan Wi-Fi atau paket data Anda, lalu muat ulang.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534] transition-colors"
          >
            <ArrowClockwise size={18} weight="bold" aria-hidden="true" />
            Muat Ulang
          </button>

          <Link
            href="/pos"
            className="min-h-11 flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[#1C1917]/15 bg-white/80 px-4 py-2.5 text-sm font-semibold text-[#1C1917] hover:bg-white transition-colors"
          >
            <Storefront size={18} weight="duotone" aria-hidden="true" />
            Buka Layar Kasir
          </Link>
        </div>
      </div>
    </main>
  );
}

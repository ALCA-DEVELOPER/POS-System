"use client";

import { useEffect, useState } from "react";
import { DownloadSimple, ShareNetwork, X } from "@phosphor-icons/react";
import { BrandLogo } from "@/components/ui/BrandLogo";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "kulinerkas_a2hs_dismissed_until";

/** Banner pemasangan PWA ke Layar Utama (Android/Desktop A2HS + panduan iOS Safari). */
export function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIosPrompt, setIsIosPrompt] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        Boolean((window.navigator as { standalone?: boolean }).standalone));

    if (isStandalone) return;

    const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) || "0");
    if (dismissedUntil > Date.now()) return;

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    if (isIos && isSafari) {
      setIsIosPrompt(true);
      setVisible(true);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const handleAppInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const dismiss = () => {
    // Sembunyikan selama 7 hari agar tidak mengganggu operasional kasir
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + sevenDaysMs));
    setVisible(false);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <aside
      aria-label="Pasang aplikasi KulinerKas"
      className="fixed bottom-20 md:bottom-5 left-3 right-3 md:left-auto md:right-5 md:w-[380px] z-50 glass-elevated rounded-2xl p-3.5 shadow-lg border border-white/80"
    >
      <div className="flex items-start gap-3">
        <BrandLogo variant="mark" size={40} decorative />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-bold text-[#1C1917] leading-snug">
            Pasang KulinerKas di Layar Utama
          </p>
          {isIosPrompt ? (
            <p className="text-xs text-[#44403C] leading-relaxed">
              Ketuk ikon{" "}
              <ShareNetwork
                size={14}
                weight="bold"
                className="inline -mt-0.5 text-[#14532D]"
                aria-hidden="true"
              />{" "}
              Bagikan di browser Safari, lalu pilih{" "}
              <span className="font-semibold text-[#1C1917]">
                Tambah ke Layar Utama
              </span>
              .
            </p>
          ) : (
            <p className="text-xs text-[#44403C] leading-relaxed">
              Akses kasir lebih cepat dalam tampilan layar penuh dan siap dipakai saat
              sinyal lambat.
            </p>
          )}
          {!isIosPrompt && (
            <div className="pt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstallClick}
                className="min-h-10 inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#166534] transition-colors"
              >
                <DownloadSimple size={16} weight="bold" aria-hidden="true" />
                Install Sekarang
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="min-h-10 rounded-xl px-3 py-2 text-xs font-medium text-[#44403C] hover:bg-black/5 transition-colors"
              >
                Nanti saja
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup banner pemasangan aplikasi"
          className="shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center text-[#44403C] hover:bg-black/5"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

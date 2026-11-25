"use client";

import type { ReactNode } from "react";
import { WarningCircle, Tray, ArrowClockwise } from "@phosphor-icons/react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** Empty state yang menjelaskan kondisi dan memberi aksi pertama (antislop R-27). */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="glass-panel rounded-2xl p-6 sm:p-8 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-[#14532D]/10 text-[#14532D] flex items-center justify-center">
        {icon ?? <Tray size={24} weight="duotone" aria-hidden="true" />}
      </div>
      <div className="space-y-1 max-w-md">
        <h3 className="text-base font-bold text-[#1C1917]">{title}</h3>
        <p className="text-sm text-[#44403C] leading-relaxed">{description}</p>
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
  rows?: number;
}

/** Skeleton loading state dengan teks status yang jelas untuk aksesibilitas (R-27). */
export function LoadingState({ label = "Memuat data...", rows = 3 }: LoadingStateProps) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="text-xs font-medium text-[#44403C]">{label}</p>
      <div className="grid gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="glass-panel rounded-2xl p-4 space-y-2.5 animate-pulse"
          >
            <div className="h-4 w-2/5 rounded bg-[#1C1917]/10" />
            <div className="h-3 w-4/5 rounded bg-[#1C1917]/8" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** Error state informatif dengan opsi coba ulang (R-27). */
export function ErrorState({
  title = "Gagal memuat data",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="glass-panel rounded-2xl p-5 border-[#B91C1C]/30 bg-red-50/75 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-[#B91C1C] text-white flex items-center justify-center">
          <WarningCircle size={22} weight="bold" aria-hidden="true" />
        </div>
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-[#1C1917]">{title}</h3>
          <p className="text-xs sm:text-sm text-[#44403C]">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#166534] transition-colors"
        >
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
          Coba Lagi
        </button>
      ) : null}
    </div>
  );
}

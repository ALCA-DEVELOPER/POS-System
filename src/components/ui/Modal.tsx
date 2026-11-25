"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  maxWidthClass?: string;
}

/** Modal dialog aksesibel: mendukung Escape, penutupan backdrop, dan pengembalian fokus. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-lg",
}: ModalProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timer = window.setTimeout(() => {
      const firstInput = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="file"]):not([type="hidden"]):not(.sr-only), select, textarea'
      );
      if (firstInput) {
        firstInput.focus();
      } else {
        panelRef.current?.focus();
      }
    }, 10);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#1C1917]/40 backdrop-blur-xs"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`glass-elevated w-full ${maxWidthClass} rounded-t-3xl sm:rounded-2xl max-h-[90dvh] flex flex-col overflow-hidden focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#1C1917]/10">
          <div className="space-y-0.5 min-w-0">
            <h2 id="modal-title" className="text-base sm:text-lg font-bold text-[#1C1917]">
              {title}
            </h2>
            {description ? (
              <p className="text-xs sm:text-sm text-[#44403C]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Tutup dialog"
            className="shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center text-[#44403C] hover:bg-black/5"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto pb-safe">{children}</div>
      </div>
    </div>
  );
}

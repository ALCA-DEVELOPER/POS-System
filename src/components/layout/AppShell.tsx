"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  House,
  CashRegister,
  Coins,
  Receipt,
  Package,
  ChartBar,
  ForkKnife,
  GearSix,
  ClockCounterClockwise,
  ShoppingBag,
  SignOut,
  List,
  X,
  WifiSlash,
  Wallet,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import { cn } from "@/lib/utils";
import { BUSINESS_SYNC_DOM_EVENT } from "@/lib/realtime";
import { BusinessRealtimeSync } from "@/components/layout/BusinessRealtimeSync";
import { BrandLogo } from "@/components/ui/BrandLogo";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  group: "Operasional" | "Keuangan & Menu";
  icon: "home" | "pos" | "orders" | "scan" | "stock" | "report" | "menu" | "expense" | "capital" | "settings" | "history";
  accent?: boolean;
}

function getNavItems(role: UserRole): {
  bottom: NavItem[];
  all: NavItem[];
} {
  if (role === "cashier") {
    const items: NavItem[] = [
      { href: "/pos", label: "Kasir POS", shortLabel: "Kasir", group: "Operasional", icon: "pos" },
      {
        href: "/pesanan",
        label: "Pesanan Pembeli",
        shortLabel: "Pesanan",
        group: "Operasional",
        icon: "orders",
      },
      {
        href: "/pos/riwayat",
        label: "Riwayat Shift",
        shortLabel: "Riwayat",
        group: "Operasional",
        icon: "history",
      },
    ];
    return { bottom: items, all: items };
  }

  if (role === "kitchen") {
    const items: NavItem[] = [
      { href: "/stok", label: "Stok & Waste Dapur", shortLabel: "Stok", group: "Operasional", icon: "stock" },
    ];
    return { bottom: items, all: items };
  }

  const all: NavItem[] = [
    { href: "/dashboard", label: "Beranda Keuangan", shortLabel: "Beranda", group: "Operasional", icon: "home" },
    { href: "/pos", label: "Kasir POS", shortLabel: "Kasir", group: "Operasional", icon: "pos" },
    {
      href: "/pesanan",
      label: "Pesanan Pembeli",
      shortLabel: "Pesanan",
      group: "Operasional",
      icon: "orders",
    },
    {
      href: "/pengeluaran/scan",
      label: "Scan Struk AI",
      shortLabel: "Scan Struk",
      group: "Operasional",
      icon: "scan",
      accent: true,
    },
    { href: "/stok", label: "Stok Bahan Baku", shortLabel: "Stok", group: "Operasional", icon: "stock" },
    { href: "/laporan", label: "Laporan Keuangan", shortLabel: "Laporan", group: "Keuangan & Menu", icon: "report" },
    { href: "/menu", label: "Menu & Resep HPP", shortLabel: "Menu", group: "Keuangan & Menu", icon: "menu" },
    {
      href: "/pengeluaran",
      label: "Daftar Pengeluaran",
      shortLabel: "Pengeluaran",
      group: "Keuangan & Menu",
      icon: "expense",
    },
    {
      href: "/modal-usaha",
      label: "Modal Usaha",
      shortLabel: "Modal",
      group: "Keuangan & Menu",
      icon: "capital",
    },
    {
      href: "/pos/riwayat",
      label: "Riwayat Transaksi",
      shortLabel: "Riwayat",
      group: "Operasional",
      icon: "history",
    },
    {
      href: "/pengaturan-bisnis",
      label: "Pengaturan Bisnis",
      shortLabel: "Pengaturan",
      group: "Keuangan & Menu",
      icon: "settings",
    },
  ];

  const bottom = all.filter((item) =>
    ["/dashboard", "/pos", "/pengeluaran/scan", "/stok", "/laporan"].includes(item.href)
  );

  return { bottom, all };
}

function NavIcon({ name, active }: { name: NavItem["icon"]; active: boolean }) {
  const weight = active ? "fill" : "duotone";
  const size = 20;
  switch (name) {
    case "home":
      return <House size={size} weight={weight} aria-hidden="true" />;
    case "pos":
      return <CashRegister size={size} weight={weight} aria-hidden="true" />;
    case "orders":
      return <ShoppingBag size={size} weight={weight} aria-hidden="true" />;
    case "scan":
      return <Receipt size={size} weight={weight} aria-hidden="true" />;
    case "stock":
      return <Package size={size} weight={weight} aria-hidden="true" />;
    case "report":
      return <ChartBar size={size} weight={weight} aria-hidden="true" />;
    case "menu":
      return <ForkKnife size={size} weight={weight} aria-hidden="true" />;
    case "expense":
      return <Wallet size={size} weight={weight} aria-hidden="true" />;
    case "capital":
      return <Coins size={size} weight={weight} aria-hidden="true" />;
    case "history":
      return <ClockCounterClockwise size={size} weight={weight} aria-hidden="true" />;
    case "settings":
      return <GearSix size={size} weight={weight} aria-hidden="true" />;
  }
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  cashier: "Kasir",
  kitchen: "Staf Dapur",
};

function BusinessBrandAvatar({
  logoUrl,
  businessName,
  size = "md",
}: {
  logoUrl: string | null;
  businessName: string;
  size?: "md" | "sm";
}) {
  const boxClass = size === "sm" ? "w-9 h-9 text-xs" : "w-10 h-10 text-sm";
  const px = size === "sm" ? 36 : 40;

  if (logoUrl) {
    return (
      <div
        className={cn(
          boxClass,
          "rounded-xl bg-white border border-[#1C1917]/10 overflow-hidden shrink-0 flex items-center justify-center"
        )}
      >
        <Image
          src={logoUrl}
          alt={businessName || "Logo usaha"}
          width={px}
          height={px}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return <BrandLogo variant="mark" size={px} decorative />;
}

function OrderCountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} pesanan aktif`}
      className={cn(
        "min-w-5 h-5 px-1.5 rounded-full bg-[#DC2626] text-white text-[11px] font-extrabold inline-flex items-center justify-center tabular-nums shrink-0 shadow-xs",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

interface AppShellProps {
  role: UserRole;
  businessName: string;
  userName: string;
  logoUrl?: string | null;
  pendingOrdersCount?: number;
  pageTitle: string;
  headerAction?: ReactNode;
  children: ReactNode;
}

/** Shell utama aplikasi PWA dengan sidebar responsif desktop/tablet dan bottom bar satu jempol mobile. */
export function AppShell({
  role,
  businessName,
  userName,
  logoUrl,
  pendingOrdersCount,
  pageTitle,
  headerAction,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [liveLogoUrl, setLiveLogoUrl] = useState<string | null>(logoUrl ?? null);
  const [liveBusinessName, setLiveBusinessName] = useState(businessName);
  const [livePendingOrdersCount, setLivePendingOrdersCount] = useState<number>(
    pendingOrdersCount ?? 0
  );

  useEffect(() => {
    setLiveLogoUrl(logoUrl ?? null);
  }, [logoUrl]);

  useEffect(() => {
    setLiveBusinessName(businessName);
  }, [businessName]);

  useEffect(() => {
    if (pendingOrdersCount !== undefined) {
      setLivePendingOrdersCount(pendingOrdersCount);
    }
  }, [pendingOrdersCount]);

  useEffect(() => {
    const onLocalSync = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          logoUrl?: string | null;
          businessName?: string;
          pendingOrdersCount?: number;
        }>
      ).detail;
      if (detail?.logoUrl !== undefined) {
        setLiveLogoUrl(detail.logoUrl);
      }
      if (detail?.businessName !== undefined) {
        setLiveBusinessName(detail.businessName);
      }
      if (detail?.pendingOrdersCount !== undefined) {
        setLivePendingOrdersCount(detail.pendingOrdersCount);
      }
    };
    window.addEventListener(BUSINESS_SYNC_DOM_EVENT, onLocalSync);
    return () => window.removeEventListener(BUSINESS_SYNC_DOM_EVENT, onLocalSync);
  }, []);

  const { bottom, all } = getNavItems(role);

  useEffect(() => {
    setIsOffline(!window.navigator.onLine);
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const handleSignOut = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const isRouteActive = (href: string) => {
    if (href === "/pengeluaran") {
      return pathname === "/pengeluaran";
    }
    if (href === "/pos") {
      return pathname === "/pos";
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const groups: Array<"Operasional" | "Keuangan & Menu"> = ["Operasional", "Keuangan & Menu"];

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      {/* Desktop / Tablet Sidebar */}
      <aside
        aria-label="Navigasi utama"
        className="no-print hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col justify-between p-4 sticky top-0 h-dvh"
      >
        <div className="glass-elevated rounded-2xl p-4 flex flex-col h-full justify-between gap-4 overflow-y-auto">
          <div className="space-y-5">
            <Link href={bottom[0]?.href ?? "/pos"} className="flex items-center gap-3 px-1">
              <BusinessBrandAvatar
                logoUrl={liveLogoUrl}
                businessName={liveBusinessName}
                size="md"
              />
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[#1C1917] truncate">
                  {liveBusinessName || "KulinerKas"}
                </p>
                <p className="text-xs text-[#44403C] truncate">
                  {userName || "Pengguna"} ({ROLE_LABELS[role]})
                </p>
              </div>
            </Link>

            <nav aria-label="Menu aplikasi" className="space-y-4">
              {groups.map((groupName) => {
                const groupItems = all.filter((i) => i.group === groupName);
                if (groupItems.length === 0) return null;
                return (
                  <div key={groupName} className="space-y-1">
                    <p className="px-2.5 text-[11px] font-semibold tracking-wide text-[#44403C]">
                      {groupName}
                    </p>
                    <ul className="space-y-1">
                      {groupItems.map((item) => {
                        const active = isRouteActive(item.href);
                        const badgeCount =
                          item.href === "/pesanan" ? livePendingOrdersCount : 0;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "min-h-11 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                                active
                                  ? "bg-[#14532D] text-white font-semibold shadow-sm"
                                  : item.accent
                                    ? "text-[#B43D0A] font-semibold hover:bg-[#B43D0A]/10"
                                    : "text-[#1C1917] font-medium hover:bg-black/5"
                              )}
                            >
                              <span className="flex items-center gap-3 min-w-0">
                                <NavIcon name={item.icon} active={active} />
                                <span className="truncate">{item.label}</span>
                              </span>
                              <OrderCountBadge count={badgeCount} />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={loggingOut}
            className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#1C1917]/15 bg-white/70 px-3 py-2 text-sm font-semibold text-[#1C1917] hover:bg-white transition-colors"
          >
            <SignOut size={18} weight="bold" aria-hidden="true" />
            {loggingOut ? "Keluar..." : "Keluar Akun"}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {isOffline ? (
          <div
            role="status"
            className="no-print bg-[#FEF3C7] text-[#92400E] border-b border-[#92400E]/20 px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2"
          >
            <WifiSlash size={16} weight="bold" aria-hidden="true" />
            Sedang offline. Perubahan transaksi memerlukan koneksi internet untuk sinkronisasi.
          </div>
        ) : null}

        <header className="no-print sticky top-0 z-30 px-3 pt-3 md:px-6 md:pt-4">
          <div className="glass-elevated rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
                aria-label="Buka menu lengkap"
                className="md:hidden min-w-11 min-h-11 -ml-1.5 px-2.5 rounded-xl inline-flex items-center gap-1.5 text-xs font-semibold text-[#1C1917] hover:bg-black/5"
              >
                <List size={20} weight="bold" aria-hidden="true" />
                <span>Menu</span>
                {role !== "kitchen" ? (
                  <OrderCountBadge count={livePendingOrdersCount} />
                ) : null}
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-[#1C1917] truncate">
                  {pageTitle}
                </h1>
                <p className="text-xs text-[#44403C] truncate md:hidden">
                  {liveBusinessName || "KulinerKas"} · {ROLE_LABELS[role]}
                </p>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <BusinessRealtimeSync />
              {headerAction ? <div>{headerAction}</div> : null}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-3 py-4 md:px-6 md:py-5 pb-28 md:pb-8 focus:outline-none"
        >
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Navigasi cepat bawah"
        className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 px-2 pb-safe pt-1.5 bg-gradient-to-t from-[#F5F2EC] via-[#F5F2EC]/90 to-transparent"
      >
        <div
          className="glass-elevated rounded-2xl px-1.5 py-1.5 grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))`,
          }}
        >
          {bottom.map((item) => {
            const active = isRouteActive(item.href);
            const badgeCount =
              item.href === "/pesanan" ? livePendingOrdersCount : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative min-h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] leading-tight transition-colors",
                  active
                    ? "bg-[#14532D] text-white font-bold"
                    : item.accent
                      ? "text-[#B43D0A] font-bold hover:bg-[#B43D0A]/10"
                      : "text-[#44403C] font-medium hover:bg-black/5"
                )}
              >
                <NavIcon name={item.icon} active={active} />
                <span className="truncate max-w-full">{item.shortLabel}</span>
                <OrderCountBadge
                  count={badgeCount}
                  className="absolute top-1 right-2 min-w-4 h-4 px-1 text-[10px]"
                />
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile Full Menu Sheet */}
      {drawerOpen ? (
        <div
          className="no-print fixed inset-0 z-50 md:hidden bg-[#1C1917]/40 backdrop-blur-xs flex"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi lengkap"
            className="glass-elevated w-[84%] max-w-xs h-full p-4 flex flex-col justify-between overflow-y-auto"
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#1C1917]/10">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BusinessBrandAvatar
                    logoUrl={liveLogoUrl}
                    businessName={liveBusinessName}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1C1917] truncate">
                      {liveBusinessName || "KulinerKas"}
                    </p>
                    <p className="text-xs text-[#44403C] truncate">
                      {userName} ({ROLE_LABELS[role]})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Tutup menu"
                  className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-[#44403C] hover:bg-black/5"
                >
                  <X size={20} weight="bold" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-4">
                {groups.map((groupName) => {
                  const groupItems = all.filter((i) => i.group === groupName);
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={groupName} className="space-y-1">
                      <p className="px-2 text-[11px] font-semibold text-[#44403C]">
                        {groupName}
                      </p>
                      <ul className="space-y-1">
                        {groupItems.map((item) => {
                          const active = isRouteActive(item.href);
                          const badgeCount =
                            item.href === "/pesanan" ? livePendingOrdersCount : 0;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={() => setDrawerOpen(false)}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                  "min-h-11 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm",
                                  active
                                    ? "bg-[#14532D] text-white font-semibold"
                                    : "text-[#1C1917] font-medium hover:bg-black/5"
                                )}
                              >
                                <span className="flex items-center gap-3 min-w-0">
                                  <NavIcon name={item.icon} active={active} />
                                  <span>{item.label}</span>
                                </span>
                                <OrderCountBadge count={badgeCount} />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={loggingOut}
              className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#1C1917]/15 bg-white/80 px-3 py-2 text-sm font-semibold text-[#1C1917]"
            >
              <SignOut size={18} weight="bold" aria-hidden="true" />
              {loggingOut ? "Keluar..." : "Keluar Akun"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

# DESIGN.md - KulinerKas Visual & UI Direction

## 1. Product Identity & Design Read
- **Product:** KulinerKas (PWA Manajemen Keuangan, HPP Resep, AI Scan Struk & POS untuk UMKM F&B)
- **Design Read:** Reading this as a mobile-first F&B financial ledger and POS workspace for Indonesian UMKM owners and staff, in a warm glassmorphic ledger style, dial `ENERGY 2 / RHYTHM 2 / MOTION 1`.
- **R-10 Owner Override:** Owner requested full Glassmorphism UI across cards, panels, modals, and navigation surfaces (`backdrop-filter: blur`), while enforcing WCAG AA >= 4.5:1 text contrast (`R-25`) and clear surface separation so POS prices and financial totals remain sharp in bright kitchen/counter lighting.

## 2. Dials & Liveliness
- **ENERGY: 2 (Balanced)** - Clear hierarchy with one focal point per screen (POS Checkout CTA, Daily Cash Health on Dashboard, Receipt Verification Action on Scan).
- **RHYTHM: 2 (Consistent with purposeful breaks)** - Distinct layouts per task: split POS catalog + cart, focused scan-verify ledger, structured BOM recipe table, and financial summary + trend charts.
- **MOTION: 1 (Minimal & snappy)** - Fast 150-200ms hover/press transitions and sheet/drawer slides only, respecting `prefers-reduced-motion: reduce`, with zero endless loops or decorative floating animations.

## 3. Color System (Max 3 Core + 1 Accent, Verified WCAG AA)
- **Canvas & Ambient Layer (Warm Ivory & Soft Culinary Wash):**
  - `--bg-canvas`: `#F5F2EC` (warm parchment base so frosted glass panels have depth without neon/purple-blue slop)
  - `--bg-ambient-sage`: `#E7EFE9` (soft culinary pandan wash behind glass layers)
  - `--bg-ambient-warm`: `#F6ECE4` (soft terracotta wash for subtle glass refraction depth)
- **Glass Surfaces:**
  - `--glass-surface`: `rgba(255, 255, 255, 0.76)` with `backdrop-filter: blur(14px)` and `1px solid rgba(255, 255, 255, 0.72)` + subtle slate border `rgba(28, 25, 23, 0.08)`
  - `--glass-elevated`: `rgba(255, 255, 255, 0.88)` (modals, drawers, bottom nav bar)
- **Ink / Typography (WCAG AA Verified via `contrast-check.py`):**
  - `--ink-primary`: `#1C1917` (Espresso Ink) - `14.92:1` against worst-case `#E7EFE9`, `16.50:1` against `#FAF8F5`
  - `--ink-muted`: `#44403C` (Warm Stone) - `8.77:1` against worst-case `#E7EFE9`
- **Brand Core & Deliberate Accent:**
  - `--brand-primary`: `#14532D` (Pandan Emerald) with `#FFFFFF` text (`9.11:1`) - primary actions, healthy margin/cash indicators, active navigation
  - `--brand-accent`: `#B43D0A` (Warm Terracotta) with `#FFFFFF` text (`5.81:1`) - key focal CTAs (Bayar, Scan Struk, Alert Stok)
- **Semantic Status (Always paired with icon + text label):**
  - `--status-danger`: `#B91C1C` with `#FFFFFF` text (`6.47:1`) - out of stock / negative margin / error
  - `--status-warning-bg`: `#FEF3C7`, `--status-warning-text`: `#92400E` (`6.37:1`) - low stock / near expiry

## 4. Typography & Numerical Precision
- **Primary Font:** `Plus Jakarta Sans` (clean Indonesian readability at dense POS & tabular screen sizes)
- **Numerical Style:** `font-variant-numeric: tabular-nums` on all Rupiah currency amounts, quantities, HPP calculations, and receipt totals.
- **No wide-tracked uppercase headings or monospace terminal styling (`R-06`).**

## 5. PWA & Mobile Ergonomics (`R-03`, `R-32`, `R-39`)
- Touch targets minimum `44px x 44px` with `8px+` spacing between adjacent POS buttons.
- `-webkit-tap-highlight-color: transparent` and clear `:active` scale/tint feedback.
- Safe-area padding (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) on fixed header, bottom nav bar, and sticky POS cart bar, with matching scroll-bottom clearance so no content is hidden.
- Full keyboard accessibility (`Tab`, `Shift+Tab`, `Enter`/`Space`, `Escape` to close modals/drawers) and high-contrast `:focus-visible` ring (`#14532D`).
- `cursor: pointer` applied in base CSS layer for all enabled interactive controls, `cursor: not-allowed` for disabled controls.

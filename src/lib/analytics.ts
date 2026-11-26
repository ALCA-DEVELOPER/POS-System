import type { CapitalEntry, Expense, Order, OrderItem } from "@/types/database";

export interface FinancialSummary {
  revenue: number;
  hppTotal: number;
  grossProfit: number;
  operatingExpenses: number;
  ingredientPurchases: number;
  totalExpenses: number;
  netProfit: number;
  netMarginPercent: number;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
  orderCount: number;
}

export interface DailySeriesPoint {
  date: string;
  label: string;
  income: number;
  expense: number;
}

export interface CategoryBreakdownPoint {
  category: string;
  amount: number;
  percent: number;
}

export interface TopProductProfit {
  product_id: string;
  product_name: string;
  quantity: number;
  revenue: number;
  hpp: number;
  profit: number;
}

/** Konversi timestamp ke YYYY-MM-DD zona waktu Asia/Jakarta (WIB, UTC+7) secara deterministik. */
export function toJakartaDateKey(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "";
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Hitung ringkasan Laba Rugi (P&L) dan Arus Kas dari daftar order & pengeluaran. */
export function computeFinancialSummary(
  orders: Array<Pick<Order, "total_amount" | "hpp_total">>,
  expenses: Array<Pick<Expense, "amount" | "category">>
): FinancialSummary {
  const revenue = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const hppTotal = orders.reduce((s, o) => s + Number(o.hpp_total || 0), 0);
  const grossProfit = revenue - hppTotal;

  // Pisahkan pembelian bahan baku (yang sudah masuk ke HPP saat menu terjual) dari beban operasional agar tidak double-counting di P&L
  const ingredientPurchases = expenses
    .filter((e) => e.category === "Bahan Baku")
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const operatingExpenses = expenses
    .filter((e) => e.category !== "Bahan Baku")
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const totalExpenses = ingredientPurchases + operatingExpenses;
  const netProfit = grossProfit - operatingExpenses;
  const netMarginPercent = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  return {
    revenue,
    hppTotal,
    grossProfit,
    operatingExpenses,
    ingredientPurchases,
    totalExpenses,
    netProfit,
    netMarginPercent,
    cashInflow: revenue,
    cashOutflow: totalExpenses,
    netCashFlow: revenue - totalExpenses,
    orderCount: orders.length,
  };
}

/** Hitung selisih hari dari hari ini WIB ke tanggal YYYY-MM-DD (untuk cek kedaluwarsa). */
export function diffDaysFromTodayWib(
  dateStr: string | null,
  todayKey = toJakartaDateKey(new Date())
): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const targetMs = Date.parse(`${dateStr}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(targetMs) || Number.isNaN(todayMs)) return null;
  return Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
}

/** Susun seri harian Pemasukan vs Pengeluaran untuk N hari terakhir. */
export function buildDailyTrendSeries(
  orders: Array<Pick<Order, "total_amount" | "created_at">>,
  expenses: Array<Pick<Expense, "amount" | "expense_date">>,
  days = 7,
  endDateKey = toJakartaDateKey(new Date())
): DailySeriesPoint[] {
  const map = new Map<string, { income: number; expense: number }>();
  const baseMs = Date.parse(`${endDateKey}T00:00:00Z`);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseMs - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { income: 0, expense: 0 });
  }

  for (const o of orders) {
    const key = toJakartaDateKey(o.created_at);
    const bucket = map.get(key);
    if (bucket) bucket.income += Number(o.total_amount || 0);
  }

  for (const e of expenses) {
    const bucket = map.get(e.expense_date);
    if (bucket) bucket.expense += Number(e.amount || 0);
  }

  return Array.from(map.entries()).map(([date, val]) => {
    const [, m, d] = date.split("-");
    return {
      date,
      label: `${d}/${m}`,
      income: Math.round(val.income),
      expense: Math.round(val.expense),
    };
  });
}

/** Hitung komposisi pengeluaran per kategori. */
export function buildExpenseBreakdown(
  expenses: Array<Pick<Expense, "category" | "amount">>
): CategoryBreakdownPoint[] {
  const totals = new Map<string, number>();
  let grand = 0;

  for (const e of expenses) {
    const amt = Number(e.amount || 0);
    if (amt <= 0) continue;
    grand += amt;
    totals.set(e.category, (totals.get(e.category) ?? 0) + amt);
  }

  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount),
      percent: grand > 0 ? (amount / grand) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** Hitung Top 5 Menu dengan total laba kotor tertinggi. */
export function buildTopProfitableProducts(
  orderItems: Array<
    Pick<OrderItem, "product_id" | "product_name" | "quantity" | "subtotal" | "unit_hpp">
  >,
  limit = 5
): TopProductProfit[] {
  const map = new Map<string, TopProductProfit>();

  for (const item of orderItems) {
    const qty = Number(item.quantity || 0);
    const rev = Number(item.subtotal || 0);
    const hpp = Number(item.unit_hpp || 0) * qty;
    const profit = rev - hpp;

    const existing = map.get(item.product_id);
    if (existing) {
      existing.quantity += qty;
      existing.revenue += rev;
      existing.hpp += hpp;
      existing.profit += profit;
    } else {
      map.set(item.product_id, {
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: qty,
        revenue: rev,
        hpp,
        profit,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.profit - a.profit)
    .slice(0, limit);
}

export interface CapitalSummary {
  totalDeposits: number;
  totalWithdrawals: number;
  netCapital: number;
}

/** Hitung ringkasan setoran, penarikan (prive), dan modal bersih usaha. */
export function computeCapitalSummary(
  entries: Array<Pick<CapitalEntry, "entry_type" | "amount">>
): CapitalSummary {
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  for (const entry of entries) {
    const amt = Number(entry.amount || 0);
    if (entry.entry_type === "withdrawal") {
      totalWithdrawals += amt;
    } else {
      totalDeposits += amt;
    }
  }

  return {
    totalDeposits,
    totalWithdrawals,
    netCapital: totalDeposits - totalWithdrawals,
  };
}

/** Deteksi error Supabase saat tabel migrasi opsional belum dijalankan. */
export function isMissingTableError(
  err: { code?: string; message?: string } | null | undefined,
  tableName: string
): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return code === "PGRST205" || code === "42P01" || msg.includes(tableName);
}

const PACKAGING_INGREDIENT_REGEX =
  /plastik|kantong|box|kotak|cup|gelas|sendok|garpu|sedotan|tutup|mika|paper|tas|stiker|label/i;

export function extractBundleCount(productName: string): number {
  const match = /^\s*(\d+)\s+/i.exec(productName.trim());
  if (!match) return 1;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

export function buildProductPieceFactors(
  recipes: Array<{
    product_id: string;
    quantity_needed: number | string;
    ingredient:
      | { name?: string | null; unit?: string | null }
      | Array<{ name?: string | null; unit?: string | null }>
      | null;
  }>
): Record<string, number> {
  const maxFoodPcsByProduct = new Map<string, number>();

  for (const row of recipes) {
    const ing = Array.isArray(row.ingredient) ? row.ingredient[0] : row.ingredient;
    if (!ing || ing.unit !== "pcs") continue;
    const ingName = (ing.name ?? "").trim();
    if (!ingName || PACKAGING_INGREDIENT_REGEX.test(ingName)) continue;

    const qty = Math.round(Number(row.quantity_needed || 0));
    if (qty > 0) {
      const prev = maxFoodPcsByProduct.get(row.product_id) ?? 0;
      if (qty > prev) maxFoodPcsByProduct.set(row.product_id, qty);
    }
  }

  return Object.fromEntries(maxFoodPcsByProduct.entries());
}

export interface TodaySoldStats {
  transactionCount: number;
  paketCount: number;
  pcsCount: number;
  revenueToday: number;
}

/** Hitung total paket, total pcs isi, dan transaksi terjual pada tanggal hari ini (WIB). */
export function computeTodaySoldStats(
  orders: Array<
    Pick<Order, "created_at" | "total_amount" | "items">
  >,
  todayKey: string,
  productPieceFactors: Record<string, number> = {}
): TodaySoldStats {
  let transactionCount = 0;
  let paketCount = 0;
  let pcsCount = 0;
  let revenueToday = 0;

  for (const order of orders) {
    if (toJakartaDateKey(order.created_at) !== todayKey) continue;
    transactionCount++;
    revenueToday += Number(order.total_amount || 0);

    for (const item of order.items ?? []) {
      const qty = Math.max(0, Number(item.quantity || 0));
      if (qty <= 0) continue;
      const bundle = extractBundleCount(item.product_name);
      const factor = productPieceFactors[item.product_id];
      const pcsPerUnit = factor && factor > 0 ? factor : bundle;

      paketCount += qty * bundle;
      pcsCount += qty * pcsPerUnit;
    }
  }

  return {
    transactionCount,
    paketCount,
    pcsCount,
    revenueToday,
  };
}

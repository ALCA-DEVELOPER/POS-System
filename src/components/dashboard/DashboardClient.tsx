"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Camera,
  CashRegister,
  ChartLineUp,
  Coins,
  Warning,
  Wallet,
} from "@phosphor-icons/react";
import {
  buildDailyTrendSeries,
  buildExpenseBreakdown,
  buildTopProfitableProducts,
  computeFinancialSummary,
  diffDaysFromTodayWib,
  toJakartaDateKey,
} from "@/lib/analytics";
import { formatNumber, formatRupiah } from "@/lib/format";
import type { Expense, Ingredient, Order, OrderItem } from "@/types/database";
import { EmptyState } from "@/components/ui/StatePanel";

const PIE_COLORS = [
  "#14532D",
  "#B43D0A",
  "#1E3A8A",
  "#92400E",
  "#44403C",
  "#0F766E",
];

interface DashboardClientProps {
  todayKey: string;
  netCapital: number;
  totalSalesAllTime: number;
  totalExpensesAllTime: number;
  actualCashBalance: number;
  orders30d: Order[];
  orderItems30d: OrderItem[];
  expenses30d: Expense[];
  ingredients: Ingredient[];
}

export function DashboardClient({
  todayKey,
  netCapital,
  totalSalesAllTime,
  totalExpensesAllTime,
  actualCashBalance,
  orders30d,
  orderItems30d,
  expenses30d,
  ingredients,
}: DashboardClientProps) {
  const [trendRange, setTrendRange] = useState<7 | 30>(7);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const todaySummary = useMemo(() => {
    const todayOrders = orders30d.filter((o) => toJakartaDateKey(o.created_at) === todayKey);
    const todayExpenses = expenses30d.filter((e) => e.expense_date === todayKey);
    return computeFinancialSummary(todayOrders, todayExpenses);
  }, [orders30d, expenses30d, todayKey]);

  const dailySeries = useMemo(
    () => buildDailyTrendSeries(orders30d, expenses30d, trendRange, todayKey),
    [orders30d, expenses30d, trendRange, todayKey]
  );

  const expenseBreakdown = useMemo(
    () => buildExpenseBreakdown(expenses30d),
    [expenses30d]
  );

  const topMenus = useMemo(
    () => buildTopProfitableProducts(orderItems30d, 5),
    [orderItems30d]
  );

  const alertIngredients = useMemo(() => {
    return ingredients
      .map((ing) => {
        const isLow = Number(ing.current_stock) <= Number(ing.minimum_stock);
        const expDays = diffDaysFromTodayWib(ing.nearest_expiry_date, todayKey);
        const nearExp = expDays !== null && expDays <= 7;
        return { ing, isLow, nearExp, expDays };
      })
      .filter((x) => x.isLow || x.nearExp);
  }, [ingredients, todayKey]);

  const hasTrendData = dailySeries.some((p) => p.income > 0 || p.expense > 0);

  return (
    <div className="space-y-5">
      {/* Focal Hero: Daily Cash Health + Primary Actions */}
      <section className="glass-elevated rounded-2xl p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-5 space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-[#14532D]">
            <Wallet size={18} weight="duotone" aria-hidden="true" />
            <span>Saldo Kas Aktual Usaha</span>
          </div>
          <p
            className={`text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight ${
              actualCashBalance < 0 ? "text-[#B91C1C]" : "text-[#1C1917]"
            }`}
          >
            {formatRupiah(actualCashBalance)}
          </p>
          <p className="text-xs text-[#44403C] leading-relaxed tabular-nums">
            Modal bersih{" "}
            <strong className="text-[#1C1917]">{formatRupiah(netCapital)}</strong> +
            penjualan{" "}
            <strong className="text-[#14532D]">{formatRupiah(totalSalesAllTime)}</strong>{" "}
            - pengeluaran{" "}
            <strong className="text-[#B43D0A]">{formatRupiah(totalExpensesAllTime)}</strong>.
          </p>

          <div className="flex flex-wrap gap-2.5 pt-2">
            <Link
              href="/pos"
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
            >
              <CashRegister size={18} weight="bold" aria-hidden="true" />
              Buka Kasir POS
            </Link>
            <Link
              href="/pengeluaran/scan"
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#9A3412] transition-colors"
            >
              <Camera size={18} weight="bold" aria-hidden="true" />
              Scan Struk Belanja
            </Link>
            <Link
              href="/modal-usaha"
              className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white/85 px-4 py-2.5 text-sm font-bold text-[#1C1917] hover:bg-white transition-colors"
            >
              <Coins size={18} weight="duotone" aria-hidden="true" />
              {netCapital === 0 ? "Catat Modal Usaha" : "Kelola Modal"}
            </Link>
          </div>
        </div>

        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white/75 border border-[#1C1917]/10 p-3.5 space-y-1">
            <p className="text-xs font-medium text-[#44403C]">Pemasukan Hari Ini</p>
            <p className="text-base sm:text-lg font-extrabold text-[#14532D] tabular-nums">
              {formatRupiah(todaySummary.revenue)}
            </p>
            <p className="text-[11px] text-[#44403C] tabular-nums">
              {todaySummary.orderCount} transaksi
            </p>
          </div>

          <div className="rounded-xl bg-white/75 border border-[#1C1917]/10 p-3.5 space-y-1">
            <p className="text-xs font-medium text-[#44403C]">Pengeluaran Hari Ini</p>
            <p className="text-base sm:text-lg font-extrabold text-[#B43D0A] tabular-nums">
              {formatRupiah(todaySummary.totalExpenses)}
            </p>
            <p className="text-[11px] text-[#44403C]">Belanja & operasional</p>
          </div>

          <div className="rounded-xl bg-white/75 border border-[#1C1917]/10 p-3.5 space-y-1">
            <p className="text-xs font-medium text-[#44403C]">Laba Kotor Hari Ini</p>
            <p className="text-base sm:text-lg font-extrabold text-[#1C1917] tabular-nums">
              {formatRupiah(todaySummary.grossProfit)}
            </p>
            <p className="text-[11px] text-[#44403C] tabular-nums">
              HPP: {formatRupiah(todaySummary.hppTotal)}
            </p>
          </div>

          <div className="rounded-xl bg-white/75 border border-[#1C1917]/10 p-3.5 space-y-1">
            <p className="text-xs font-medium text-[#44403C]">Laba Bersih Hari Ini</p>
            <p
              className={`text-base sm:text-lg font-extrabold tabular-nums ${
                todaySummary.netProfit < 0 ? "text-[#B91C1C]" : "text-[#14532D]"
              }`}
            >
              {formatRupiah(todaySummary.netProfit)}
            </p>
            <p className="text-[11px] font-semibold text-[#44403C] tabular-nums">
              Margin: {todaySummary.netMarginPercent.toFixed(1)}%
            </p>
          </div>
        </div>
      </section>

      {/* Important Inventory Alerts */}
      {alertIngredients.length > 0 ? (
        <section
          aria-label="Peringatan stok bahan baku"
          className="glass-panel rounded-2xl p-4 sm:p-5 border-[#B43D0A]/30 bg-amber-50/75 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#92400E]">
              <Warning size={20} weight="bold" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-bold">
                Peringatan Stok Kritis & Kedaluwarsa ({alertIngredients.length})
              </h2>
            </div>
            <Link
              href="/stok"
              className="text-xs font-bold text-[#14532D] hover:underline shrink-0"
            >
              Kelola Stok
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {alertIngredients.slice(0, 6).map(({ ing, isLow, nearExp, expDays }) => (
              <div
                key={ing.id}
                className="rounded-xl bg-white/90 border border-[#92400E]/20 px-3.5 py-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1C1917] truncate">{ing.name}</p>
                  <p className="text-xs text-[#44403C] tabular-nums">
                    Sisa: {formatNumber(ing.current_stock)} {ing.unit}
                    {nearExp && ing.nearest_expiry_date
                      ? ` · Exp ${expDays !== null && expDays <= 0 ? "lewat" : `${expDays}h lagi`}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[11px] font-bold">
                  {isLow ? (Number(ing.current_stock) <= 0 ? "Habis" : "Menipis") : "Segera Exp"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Trend Chart + Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#1C1917]">
                Perbandingan Pemasukan vs Pengeluaran Harian
              </h2>
              <p className="text-xs text-[#44403C]">
                Pantau apakah omzet harian menutupi belanja & beban operasional.
              </p>
            </div>
            <div className="flex gap-1.5 bg-black/5 p-1 rounded-xl self-start">
              {([7, 30] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setTrendRange(days)}
                  className={`min-h-8 rounded-lg px-3 text-xs font-bold ${
                    trendRange === days
                      ? "bg-white text-[#14532D] shadow-xs"
                      : "text-[#44403C]"
                  }`}
                >
                  {days} Hari
                </button>
              ))}
            </div>
          </div>

          {!hasTrendData ? (
            <EmptyState
              title="Belum ada pergerakan transaksi 30 hari terakhir"
              description="Catat penjualan di Kasir POS atau belanja di Scan Struk untuk melihat grafik tren harian."
              icon={<ChartLineUp size={24} weight="duotone" aria-hidden="true" />}
            />
          ) : (
            <div className="h-64 w-full">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,25,23,0.1)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#44403C" }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#44403C" }}
                      tickFormatter={(v: number) =>
                        v >= 1000000
                          ? `${(v / 1000000).toFixed(1)}jt`
                          : v >= 1000
                            ? `${Math.round(v / 1000)}rb`
                            : String(v)
                      }
                    />
                    <Tooltip
                      formatter={(val: unknown, name: unknown) => [
                        formatRupiah(Number(val)),
                        name === "income" ? "Pemasukan" : "Pengeluaran",
                      ]}
                    />
                    <Bar dataKey="income" name="income" fill="#14532D" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expense" name="expense" fill="#B43D0A" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-4 text-xs font-semibold text-[#1C1917]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-[#14532D]" /> Pemasukan
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-[#B43D0A]" /> Pengeluaran
            </span>
          </div>
        </section>

        {/* Expense Breakdown Pie */}
        <section className="lg:col-span-5 glass-panel rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#1C1917]">
              Komposisi Pengeluaran (30 Hari Terakhir)
            </h2>
            <p className="text-xs text-[#44403C]">
              Pos biaya terbesar yang menyerap kas usaha Anda.
            </p>
          </div>

          {expenseBreakdown.length === 0 ? (
            <EmptyState
              title="Belum ada data pengeluaran"
              description="Scan struk belanja atau catat biaya sewa/gaji/listrik untuk melihat porsi pengeluaran."
            />
          ) : (
            <div className="space-y-4">
              <div className="h-48 w-full">
                {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseBreakdown}
                        dataKey="amount"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius={44}
                        outerRadius={78}
                        paddingAngle={2}
                      >
                        {expenseBreakdown.map((entry, idx) => (
                          <Cell
                            key={entry.category}
                            fill={PIE_COLORS[idx % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: unknown) => formatRupiah(Number(val))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : null}
              </div>

              <ul className="space-y-1.5 text-xs">
                {expenseBreakdown.map((entry, idx) => (
                  <li
                    key={entry.category}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="inline-flex items-center gap-2 font-semibold text-[#1C1917]">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                      />
                      {entry.category}
                    </span>
                    <span className="tabular-nums font-bold text-[#1C1917]">
                      {formatRupiah(entry.amount)}{" "}
                      <span className="text-[#44403C] font-normal">
                        ({entry.percent.toFixed(0)}%)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Top 5 Most Profitable Menus */}
      <section className="glass-panel rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[#1C1917]">
              Top 5 Menu Paling Menguntungkan (30 Hari Terakhir)
            </h2>
            <p className="text-xs text-[#44403C]">
              Diurutkan berdasarkan total laba kotor riil (Omzet dikurangi HPP resep).
            </p>
          </div>
          <Link href="/menu" className="text-xs font-bold text-[#14532D] hover:underline">
            Lihat Resep & HPP
          </Link>
        </div>

        {topMenus.length === 0 ? (
          <EmptyState
            title="Belum ada data menu terjual"
            description="Setelah transaksi POS tercatat, daftar menu yang menyumbang profit terbesar akan muncul di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-black/5 text-[#44403C]">
                <tr>
                  <th className="px-3.5 py-2.5 font-semibold">Menu</th>
                  <th className="px-3.5 py-2.5 font-semibold text-right">Terjual</th>
                  <th className="px-3.5 py-2.5 font-semibold text-right">Omzet</th>
                  <th className="px-3.5 py-2.5 font-semibold text-right">Total HPP</th>
                  <th className="px-3.5 py-2.5 font-semibold text-right">Laba Kotor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C1917]/10 tabular-nums">
                {topMenus.map((m, idx) => (
                  <tr key={m.product_id}>
                    <td className="px-3.5 py-2.5 font-bold text-[#1C1917]">
                      {idx + 1}. {m.product_name}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">{m.quantity} porsi</td>
                    <td className="px-3.5 py-2.5 text-right">{formatRupiah(m.revenue)}</td>
                    <td className="px-3.5 py-2.5 text-right text-[#44403C]">
                      {formatRupiah(m.hpp)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-extrabold text-[#14532D]">
                      {formatRupiah(m.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

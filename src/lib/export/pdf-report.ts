"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { FinancialSummary } from "@/lib/analytics";
import { formatDateId, formatRupiah, PAYMENT_METHOD_LABELS } from "@/lib/format";
import type { Expense, Order } from "@/types/database";

/** Buat dan unduh laporan keuangan periodik dalam format PDF A4. */
export function downloadFinancialPdf(params: {
  businessName: string;
  startDate: string;
  endDate: string;
  summary: FinancialSummary;
  orders: Order[];
  expenses: Expense[];
}) {
  const { businessName, startDate, endDate, summary, orders, expenses } = params;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.text(businessName || "KulinerKas", 14, 18);
  doc.setFontSize(11);
  doc.text(`Laporan Keuangan & Arus Kas (${startDate} s/d ${endDate})`, 14, 25);

  autoTable(doc, {
    startY: 31,
    head: [["Ringkasan Laba Rugi & Arus Kas", "Nominal"]],
    body: [
      ["Omzet Penjualan", formatRupiah(summary.revenue)],
      ["HPP Resep Terjual", formatRupiah(summary.hppTotal)],
      ["Laba Kotor", formatRupiah(summary.grossProfit)],
      ["Beban Operasional (Non-Bahan Baku Resep)", formatRupiah(summary.operatingExpenses)],
      ["Laba Bersih", `${formatRupiah(summary.netProfit)} (${summary.netMarginPercent.toFixed(1)}%)`],
      ["Total Belanja Bahan Baku", formatRupiah(summary.ingredientPurchases)],
      ["Total Kas Keluar", formatRupiah(summary.totalExpenses)],
      ["Arus Kas Bersih", formatRupiah(summary.netCashFlow)],
    ],
    headStyles: { fillColor: [20, 83, 45] },
  });

  const lastY1 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 95;

  if (orders.length > 0) {
    autoTable(doc, {
      startY: lastY1 + 8,
      head: [["No. Order", "Pelanggan", "Waktu", "Metode", "Omzet", "HPP"]],
      body: orders.slice(0, 60).map((o) => [
        o.order_number,
        o.notes || "-",
        formatDateId(o.created_at, true),
        PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method,
        formatRupiah(o.total_amount),
        formatRupiah(o.hpp_total ?? 0),
      ]),
      headStyles: { fillColor: [20, 83, 45] },
    });
  }

  const lastY2 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? lastY1 + 10;

  if (expenses.length > 0) {
    autoTable(doc, {
      startY: lastY2 + 8,
      head: [["Tanggal", "Kategori", "Supplier / Keterangan", "Nominal"]],
      body: expenses.slice(0, 60).map((e) => [
        e.expense_date,
        e.category,
        e.supplier_name || e.description || "-",
        formatRupiah(e.amount),
      ]),
      headStyles: { fillColor: [180, 61, 10] },
    });
  }

  doc.save(`Laporan-KulinerKas-${startDate}-sd-${endDate}.pdf`);
}

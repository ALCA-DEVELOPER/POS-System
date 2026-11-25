import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import {
  computeCapitalSummary,
  computeFinancialSummary,
  isMissingTableError,
} from "@/lib/analytics";
import { formatDateId, PAYMENT_METHOD_LABELS } from "@/lib/format";
import type { CapitalEntry, Expense, Order } from "@/types/database";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json(
      { error: "Parameter tanggal start dan end (YYYY-MM-DD) wajib valid" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id, business_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "owner" || !profile.is_active) {
    return NextResponse.json({ error: "Hanya owner yang dapat mengekspor laporan" }, { status: 403 });
  }

  const startIso = `${start}T00:00:00+07:00`;
  const endIso = `${end}T23:59:59+07:00`;

  const [{ data: ordersRaw }, { data: expensesRaw }, { data: capitalsRaw, error: capErr }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", profile.business_id)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("*")
        .eq("user_id", profile.business_id)
        .gte("expense_date", start)
        .lte("expense_date", end)
        .order("expense_date", { ascending: false }),
      supabase
        .from("capital_entries")
        .select("*")
        .eq("user_id", profile.business_id)
        .gte("entry_date", start)
        .lte("entry_date", end)
        .order("entry_date", { ascending: false }),
    ]);

  const orders = (ordersRaw as Order[] | null) ?? [];
  const expenses = (expensesRaw as Expense[] | null) ?? [];
  const capitals = isMissingTableError(capErr, "capital_entries")
    ? []
    : ((capitalsRaw as CapitalEntry[] | null) ?? []);
  const summary = computeFinancialSummary(orders, expenses);
  const capitalSummary = computeCapitalSummary(capitals);

  const wb = new ExcelJS.Workbook();
  wb.creator = "KulinerKas";

  // Sheet 1: Ringkasan Laba Rugi & Arus Kas
  const summarySheet = wb.addWorksheet("Ringkasan Keuangan");
  summarySheet.columns = [
    { header: "Keterangan", key: "label", width: 38 },
    { header: "Nominal (IDR)", key: "amount", width: 22 },
  ];
  summarySheet.addRows([
    { label: `Usaha: ${profile.business_name || "KulinerKas"}`, amount: "" },
    { label: `Periode: ${start} s/d ${end}`, amount: "" },
    { label: "", amount: "" },
    { label: "Omzet Penjualan (Pemasukan)", amount: summary.revenue },
    { label: "Total HPP Resep Terjual", amount: summary.hppTotal },
    { label: "Laba Kotor (Omzet - HPP)", amount: summary.grossProfit },
    { label: "Beban Operasional (Non-Bahan Baku Resep)", amount: summary.operatingExpenses },
    { label: "Laba Bersih", amount: summary.netProfit },
    { label: "Net Margin (%)", amount: Number(summary.netMarginPercent.toFixed(2)) },
    { label: "", amount: "" },
    { label: "Total Belanja Bahan Baku (Kas Keluar)", amount: summary.ingredientPurchases },
    { label: "Total Seluruh Pengeluaran Kas", amount: summary.totalExpenses },
    { label: "Modal Usaha Bersih (Periode)", amount: capitalSummary.netCapital },
    {
      label: "Arus Kas Bersih (Modal + Cash In - Cash Out)",
      amount: summary.netCashFlow + capitalSummary.netCapital,
    },
  ]);

  // Sheet 2: Penjualan POS
  const salesSheet = wb.addWorksheet("Penjualan POS");
  salesSheet.columns = [
    { header: "No. Order", key: "order_number", width: 20 },
    { header: "Nama Pelanggan", key: "customer_name", width: 22 },
    { header: "Tanggal & Jam", key: "created_at", width: 22 },
    { header: "Metode Bayar", key: "payment_method", width: 16 },
    { header: "Subtotal", key: "subtotal", width: 16 },
    { header: "Diskon", key: "discount", width: 14 },
    { header: "Pajak + Servis", key: "tax_service", width: 16 },
    { header: "Total Omzet", key: "total", width: 18 },
    { header: "HPP", key: "hpp", width: 16 },
  ];
  for (const o of orders) {
    salesSheet.addRow({
      order_number: o.order_number,
      customer_name: o.notes || "-",
      created_at: formatDateId(o.created_at, true),
      payment_method: PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method,
      subtotal: Number(o.subtotal),
      discount: Number(o.discount_amount),
      tax_service: Number(o.tax_amount) + Number(o.service_amount),
      total: Number(o.total_amount),
      hpp: Number(o.hpp_total ?? 0),
    });
  }

  // Sheet 3: Pengeluaran
  const expSheet = wb.addWorksheet("Pengeluaran");
  expSheet.columns = [
    { header: "Tanggal", key: "date", width: 16 },
    { header: "Kategori", key: "category", width: 18 },
    { header: "Supplier", key: "supplier", width: 24 },
    { header: "Keterangan", key: "description", width: 32 },
    { header: "Sumber Dana", key: "source", width: 14 },
    { header: "Nominal", key: "amount", width: 18 },
  ];
  for (const e of expenses) {
    expSheet.addRow({
      date: e.expense_date,
      category: e.category,
      supplier: e.supplier_name || "-",
      description: e.description || "-",
      source: e.payment_source,
      amount: Number(e.amount),
    });
  }

  // Sheet 4: Modal Usaha
  const capitalSheet = wb.addWorksheet("Modal Usaha");
  capitalSheet.columns = [
    { header: "Tanggal", key: "date", width: 16 },
    { header: "Jenis", key: "type", width: 20 },
    { header: "Sumber Dana", key: "source", width: 14 },
    { header: "Keterangan", key: "notes", width: 32 },
    { header: "Nominal", key: "amount", width: 18 },
  ];
  for (const c of capitals) {
    capitalSheet.addRow({
      date: c.entry_date,
      type: c.entry_type === "deposit" ? "Setoran Modal" : "Tarik Modal (Prive)",
      source: c.payment_source,
      notes: c.notes || "-",
      amount: c.entry_type === "deposit" ? Number(c.amount) : -Number(c.amount),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `Laporan-KulinerKas-${start}-sd-${end}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

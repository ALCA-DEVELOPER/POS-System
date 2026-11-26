import { NextResponse } from "next/server";
import { requireTeamAccess } from "@/lib/server/api-auth";
import { syncUnlinkedOrdersToCustomerOrders } from "@/lib/server/order-ledger";

/**
 * Menyinkronkan transaksi di tabel `orders` (Riwayat Kasir) yang belum tercatat
 * di `customer_orders` (Pesanan Pembeli) agar semua riwayat transaksi ikut terpantau.
 */
export async function POST() {
  const auth = await requireTeamAccess(
    "Hanya owner atau kasir yang dapat menyinkronkan pesanan"
  );
  if (auth.error) return auth.error;

  const { profile, admin } = auth;

  try {
    const result = await syncUnlinkedOrdersToCustomerOrders(admin, profile.business_id);

    if (result.syncedCount > 0) {
      try {
        const channel = admin.channel(`kulinerkas-biz-${profile.business_id}`);
        await channel.httpSend("sync", { scope: "customer_orders", at: Date.now() });
        await admin.removeChannel(channel);
      } catch {
        // Abaikan jika broadcast gagal; router.refresh tetap memperbarui data
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menyinkronkan riwayat transaksi" },
      { status: 500 }
    );
  }
}

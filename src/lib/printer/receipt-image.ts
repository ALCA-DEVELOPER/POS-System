import {
  formatDateId,
  formatRupiah,
  PAYMENT_METHOD_LABELS,
} from "@/lib/format";
import type { Order, StorePosConfig } from "@/types/database";

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function loadCorsImage(url: string, timeoutMs = 1500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Merender struk/invoice ke gambar beresolusi tinggi (PNG atau WebP) via HTML5 Canvas
 * sehingga aman di seluruh CSS modern & langsung siap dikirim lewat WhatsApp.
 */
export async function renderReceiptToImageBlob(
  order: Order,
  store: StorePosConfig,
  format: "png" | "webp" = "png"
): Promise<{ blob: Blob; actualFormat: "png" | "webp" }> {
  const width = 680;
  const padX = 44;
  const innerWidth = width - padX * 2;
  const fontFamily =
    '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) {
    throw new Error("Browser tidak mendukung pembuatan gambar struk.");
  }

  const logoImg = store.logo_url ? await loadCorsImage(store.logo_url) : null;

  const storeTitle = (store.business_name || "KulinerKas").toUpperCase();
  const serviceLabel = order.order_type === "online" ? "Ongkir" : "Servis";
  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const isUnpaidOnline =
    order.order_type === "online" && Number(order.amount_paid) === 0;

  mctx.font = `800 30px ${fontFamily}`;
  const titleLines = wrapText(mctx, storeTitle, innerWidth);

  mctx.font = `500 20px ${fontFamily}`;
  const addressLines = store.address ? wrapText(mctx, store.address, innerWidth) : [];
  const phoneLines = store.phone ? [`WA: ${store.phone}`] : [];

  mctx.font = `600 20px ${fontFamily}`;
  const customerLines = order.notes
    ? wrapText(mctx, `Pelanggan: ${order.notes}`, innerWidth)
    : [];

  mctx.font = `700 22px ${fontFamily}`;
  const itemBlocks = (order.items ?? []).map((it) => ({
    nameLines: wrapText(mctx, it.product_name, innerWidth),
    qtyLine: `${it.quantity} x ${formatRupiah(it.unit_price)}`,
    subtotalText: formatRupiah(it.subtotal),
  }));

  // Hitung tinggi presisi agar bawah struk tidak terpotong atau terlalu panjang
  let y = 44;
  if (logoImg) y += 92;
  y += titleLines.length * 36;
  y += addressLines.length * 26;
  y += phoneLines.length * 26;
  y += 26; // divider
  y += 28 + 28; // No + Waktu
  y += customerLines.length * 26;
  y += 26; // divider
  for (const blk of itemBlocks) {
    y += blk.nameLines.length * 28 + 30 + 10;
  }
  y += 20; // divider
  y += 30; // Subtotal
  if (Number(order.discount_amount) > 0) y += 30;
  if (Number(order.service_amount) > 0) y += 30;
  if (Number(order.tax_amount) > 0) y += 30;
  y += 18; // total line
  y += 42; // TOTAL
  y += 32; // Bayar
  if (order.payment_method === "cash") y += 32;
  y += 58; // status pill
  y += 28; // divider
  y += 52; // footer + bottom padding

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(520, y);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Gagal menginisialisasi kanvas struk.");
  }

  // Background kertas putih bersih + border halus
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#E7E5E4";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

  const drawDashedDivider = (posY: number) => {
    ctx.save();
    ctx.strokeStyle = "#D6D3D1";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(padX, posY);
    ctx.lineTo(width - padX, posY);
    ctx.stroke();
    ctx.restore();
  };

  const drawRow = (
    posY: number,
    left: string,
    right: string,
    options?: {
      font?: string;
      leftColor?: string;
      rightColor?: string;
    }
  ) => {
    ctx.font = options?.font ?? `500 21px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillStyle = options?.leftColor ?? "#44403C";
    ctx.fillText(left, padX, posY);
    ctx.textAlign = "right";
    ctx.fillStyle = options?.rightColor ?? "#1C1917";
    ctx.fillText(right, width - padX, posY);
  };

  let curY = 44;

  // Logo toko (jika tersedia & ramah CORS)
  if (logoImg) {
    const logoSize = 72;
    const lx = (width - logoSize) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(lx, curY, logoSize, logoSize, 16);
    ctx.clip();
    ctx.drawImage(logoImg, lx, curY, logoSize, logoSize);
    ctx.restore();
    curY += logoSize + 20;
  }

  // Header toko
  ctx.textAlign = "center";
  ctx.font = `800 30px ${fontFamily}`;
  ctx.fillStyle = "#1C1917";
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, curY + 24);
    curY += 36;
  }

  ctx.font = `500 20px ${fontFamily}`;
  ctx.fillStyle = "#57534E";
  for (const line of addressLines) {
    ctx.fillText(line, width / 2, curY + 18);
    curY += 26;
  }
  for (const line of phoneLines) {
    ctx.fillText(line, width / 2, curY + 18);
    curY += 26;
  }

  curY += 8;
  drawDashedDivider(curY);
  curY += 26;

  // Metadata transaksi
  ctx.textAlign = "left";
  ctx.font = `600 20px ${fontFamily}`;
  ctx.fillStyle = "#57534E";
  ctx.fillText(`No: ${order.order_number}`, padX, curY + 14);
  curY += 28;
  ctx.fillText(`Waktu: ${formatDateId(order.created_at, true)}`, padX, curY + 14);
  curY += 28;

  if (customerLines.length > 0) {
    ctx.font = `700 20px ${fontFamily}`;
    ctx.fillStyle = "#1C1917";
    for (const line of customerLines) {
      ctx.fillText(line, padX, curY + 14);
      curY += 26;
    }
  }

  curY += 8;
  drawDashedDivider(curY);
  curY += 24;

  // Item pesanan
  for (const blk of itemBlocks) {
    ctx.textAlign = "left";
    ctx.font = `700 22px ${fontFamily}`;
    ctx.fillStyle = "#1C1917";
    for (const line of blk.nameLines) {
      ctx.fillText(line, padX, curY + 18);
      curY += 28;
    }
    drawRow(curY + 14, blk.qtyLine, blk.subtotalText, {
      font: `500 20px ${fontFamily}`,
      leftColor: "#57534E",
      rightColor: "#1C1917",
    });
    curY += 38;
  }

  curY += 4;
  drawDashedDivider(curY);
  curY += 28;

  // Ringkasan biaya
  drawRow(curY, "Subtotal", formatRupiah(order.subtotal));
  curY += 30;
  if (Number(order.discount_amount) > 0) {
    drawRow(curY, "Diskon", `-${formatRupiah(order.discount_amount)}`, {
      leftColor: "#B43D0A",
      rightColor: "#B43D0A",
    });
    curY += 30;
  }
  if (Number(order.service_amount) > 0) {
    drawRow(curY, serviceLabel, formatRupiah(order.service_amount));
    curY += 30;
  }
  if (Number(order.tax_amount) > 0) {
    drawRow(curY, "Pajak", formatRupiah(order.tax_amount));
    curY += 30;
  }

  curY += 4;
  drawDashedDivider(curY);
  curY += 34;

  drawRow(curY, "TOTAL", formatRupiah(order.total_amount), {
    font: `800 28px ${fontFamily}`,
    leftColor: "#1C1917",
    rightColor: "#14532D",
  });
  curY += 36;

  drawRow(
    curY,
    `Bayar (${paymentLabel})`,
    isUnpaidOnline ? "Menunggu Validasi" : formatRupiah(order.amount_paid),
    {
      font: `600 20px ${fontFamily}`,
      leftColor: "#57534E",
      rightColor: isUnpaidOnline ? "#B43D0A" : "#1C1917",
    }
  );
  curY += 32;

  if (order.payment_method === "cash") {
    drawRow(curY, "Kembali", formatRupiah(order.change_amount), {
      font: `700 20px ${fontFamily}`,
      leftColor: "#14532D",
      rightColor: "#14532D",
    });
    curY += 32;
  }

  // Pill status pembayaran
  const statusText = isUnpaidOnline ? "MENUNGGU VALIDASI" : "LUNAS";
  const pillW = isUnpaidOnline ? 250 : 120;
  const pillH = 34;
  const pillX = (width - pillW) / 2;
  ctx.fillStyle = isUnpaidOnline ? "#FEF3C7" : "#DCFCE7";
  ctx.beginPath();
  ctx.roundRect(pillX, curY + 6, pillW, pillH, 999);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.font = `800 17px ${fontFamily}`;
  ctx.fillStyle = isUnpaidOnline ? "#92400E" : "#14532D";
  ctx.fillText(statusText, width / 2, curY + 29);
  curY += 56;

  drawDashedDivider(curY);
  curY += 34;

  ctx.textAlign = "center";
  ctx.font = `600 20px ${fontFamily}`;
  ctx.fillStyle = "#57534E";
  ctx.fillText("Terima kasih sudah berbelanja!", width / 2, curY);

  const mime = format === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (res) => {
        if (res) resolve(res);
        else reject(new Error("Gagal mengekspor gambar struk."));
      },
      mime,
      0.95
    );
  });

  return {
    blob,
    actualFormat: blob.type === "image/webp" ? "webp" : "png",
  };
}

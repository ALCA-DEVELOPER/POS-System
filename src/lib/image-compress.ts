"use client";

/**
 * Kompres foto dari kamera HP sebelum diunggah dan dipindai Gemini Vision,
 * agar hemat kuota 4G dan menjaga ukuran payload tetap cepat.
 */
export async function compressImageFile(
  file: File,
  maxWidth = 1600,
  quality = 0.82
): Promise<{ blob: Blob; base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("File gambar tidak dapat dimuat"));
    image.src = dataUrl;
  });

  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const targetWidth = Math.round(img.width * scale);
  const targetHeight = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas browser tidak tersedia");
  }
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const mimeType = "image/jpeg";
  const compressedDataUrl = canvas.toDataURL(mimeType, quality);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Gagal mengompres gambar"))),
      mimeType,
      quality
    );
  });

  return {
    blob,
    base64: compressedDataUrl,
    mimeType,
  };
}

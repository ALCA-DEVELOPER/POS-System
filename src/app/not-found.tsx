import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main
      id="main-content"
      className="min-h-dvh flex items-center justify-center px-4 py-10"
    >
      <div className="glass-elevated max-w-md w-full rounded-2xl p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-[#14532D] text-white flex items-center justify-center font-extrabold text-sm">
          404
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold text-[#1C1917]">
            Halaman Tidak Ditemukan
          </h1>
          <p className="text-sm text-[#44403C]">
            Tautan yang Anda buka tidak tersedia atau sudah dipindahkan.
          </p>
        </div>
        <Link
          href="/"
          className="min-h-11 inline-flex items-center justify-center rounded-xl bg-[#14532D] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
        >
          Kembali ke Beranda
        </Link>
      </div>
    </main>
  );
}

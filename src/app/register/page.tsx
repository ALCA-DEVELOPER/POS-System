"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { CheckCircle, Storefront, WarningCircle } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/components/ui/BrandLogo";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justDeleted = searchParams.get("deleted") === "1";
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg("Kata sandi minimal terdiri dari 8 karakter.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Konfirmasi kata sandi tidak sama.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          data: {
            business_name: businessName.trim(),
            owner_name: ownerName.trim(),
            full_name: ownerName.trim(),
            phone: phone.trim(),
          },
        },
      });

      if (error) {
        setErrorMsg(error.message || "Pendaftaran gagal. Periksa data yang Anda isi.");
        return;
      }

      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setNeedsConfirmation(true);
      }
    } catch {
      setErrorMsg("Terjadi gangguan jaringan saat mendaftarkan akun.");
    } finally {
      setLoading(false);
    }
  };

  if (needsConfirmation) {
    return (
      <main id="main-content" className="min-h-dvh flex items-center justify-center px-4 py-8">
        <div className="glass-elevated max-w-md w-full rounded-2xl p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#14532D] text-white flex items-center justify-center">
            <CheckCircle size={26} weight="bold" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-[#1C1917]">Periksa Kotak Masuk Email</h1>
          <p className="text-sm text-[#44403C] leading-relaxed">
            Tautan konfirmasi akun untuk{" "}
            <span className="font-semibold text-[#1C1917]">{businessName}</span> telah
            dikirim ke <span className="font-semibold text-[#1C1917]">{email}</span>.
            Klik tautan di email tersebut untuk mulai menggunakan KulinerKas.
          </p>
          <Link
            href="/login"
            className="min-h-11 inline-flex items-center justify-center rounded-xl bg-[#14532D] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#166534] transition-colors"
          >
            Kembali ke Halaman Masuk
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-dvh flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <BrandLogo variant="full" size={76} priority className="mx-auto shadow-xs" />
          <h1 className="text-2xl font-extrabold text-[#1C1917]">
            Daftarkan Usaha Kuliner
          </h1>
          <p className="text-sm text-[#44403C]">
            Buat akun Owner untuk mengelola kasir, stok bahan, dan laporan laba rugi.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass-elevated rounded-2xl p-6 space-y-4">
          {justDeleted ? (
            <div
              role="status"
              className="rounded-xl border border-[#14532D]/30 bg-emerald-50/90 px-3.5 py-3 text-xs sm:text-sm text-[#1C1917] flex items-start gap-2.5"
            >
              <CheckCircle
                size={18}
                weight="bold"
                className="shrink-0 text-[#14532D] mt-0.5"
                aria-hidden="true"
              />
              <span>
                Akun dan data usaha sebelumnya sudah dihapus permanen. Email Anda kini
                dapat dipakai kembali untuk membuat bisnis baru.
              </span>
            </div>
          ) : null}

          {errorMsg ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50/90 px-3.5 py-3 text-xs sm:text-sm text-[#1C1917] flex items-start gap-2.5"
            >
              <WarningCircle
                size={18}
                weight="bold"
                className="shrink-0 text-[#B91C1C] mt-0.5"
                aria-hidden="true"
              />
              <span>{errorMsg}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label
              htmlFor="businessName"
              className="block text-sm font-semibold text-[#1C1917]"
            >
              Nama Usaha / Resto / Kedai
            </label>
            <input
              id="businessName"
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Contoh: Warung Ayam Bakar Mbak Sari"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="ownerName"
                className="block text-sm font-semibold text-[#1C1917]"
              >
                Nama Pemilik
              </label>
              <input
                id="ownerName"
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Nama lengkap Anda"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="phone" className="block text-sm font-semibold text-[#1C1917]">
                No. WhatsApp Usaha
              </label>
              <input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812xxxxxxxx"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-semibold text-[#1C1917]">
              Alamat Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@usaha.com"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-[#1C1917]"
              >
                Kata Sandi
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 karakter"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-[#1C1917]"
              >
                Ulangi Kata Sandi
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ketik ulang sandi"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-3 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
          >
            <Storefront size={18} weight="bold" aria-hidden="true" />
            {loading ? "Mendaftarkan usaha..." : "Buat Akun Bisnis Sekarang"}
          </button>

          <p className="text-center text-xs sm:text-sm text-[#44403C] pt-1">
            Sudah punya akun?{" "}
            <Link href="/login" className="font-bold text-[#14532D] hover:underline">
              Masuk di sini
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center p-4 text-sm text-[#44403C]">
          Memuat halaman pendaftaran...
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

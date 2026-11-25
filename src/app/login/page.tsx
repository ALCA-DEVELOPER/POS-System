"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Eye, EyeSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/components/ui/BrandLogo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    errorParam === "akun_nonaktif"
      ? "Akun Anda dinonaktifkan oleh pemilik usaha. Hubungi owner untuk mengaktifkan kembali."
      : errorParam === "auth_callback"
        ? "Tautan masuk atau verifikasi sudah kedaluwarsa. Silakan ulangi kembali."
        : null
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setErrorMsg("Email atau kata sandi tidak sesuai. Periksa kembali lalu coba lagi.");
        return;
      }

      // Cek role untuk arahkan langsung ke layar kerja yang sesuai
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profile && !profile.is_active) {
        await supabase.auth.signOut();
        setErrorMsg("Akun Anda sedang nonaktif. Hubungi owner usaha.");
        return;
      }

      const role = profile?.role ?? "owner";
      const safeNext = nextPath && nextPath.startsWith("/") ? nextPath : null;
      const target =
        safeNext ??
        (role === "cashier" ? "/pos" : role === "kitchen" ? "/stok" : "/dashboard");

      router.replace(target);
      router.refresh();
    } catch {
      setErrorMsg("Terjadi gangguan jaringan saat mencoba masuk. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="min-h-dvh flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <BrandLogo variant="full" size={76} priority className="mx-auto shadow-xs" />
          <h1 className="text-2xl font-extrabold text-[#1C1917]">
            Masuk ke KulinerKas
          </h1>
          <p className="text-sm text-[#44403C]">
            Kelola kasir, resep HPP, dan catatan keuangan usaha kuliner Anda.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="glass-elevated rounded-2xl p-6 space-y-4"
        >
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
            <label htmlFor="email" className="block text-sm font-semibold text-[#1C1917]">
              Alamat Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@usaha.com"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-[#1C1917]"
              >
                Kata Sandi
              </label>
              <Link
                href="/lupa-password"
                className="text-xs font-semibold text-[#14532D] hover:underline py-1"
              >
                Lupa kata sandi?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 pl-3.5 pr-11 py-2.5 text-sm text-[#1C1917] placeholder:text-[#44403C]/60"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan kata sandi" : "Lihat kata sandi"}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg inline-flex items-center justify-center text-[#44403C] hover:bg-black/5"
              >
                {showPassword ? (
                  <EyeSlash size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-3 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
          >
            <SignIn size={18} weight="bold" aria-hidden="true" />
            {loading ? "Memverifikasi akun..." : "Masuk ke Aplikasi"}
          </button>

          <p className="text-center text-xs sm:text-sm text-[#44403C] pt-1">
            Belum mendaftarkan usaha?{" "}
            <Link href="/register" className="font-bold text-[#14532D] hover:underline">
              Daftar Akun Bisnis Baru
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center p-4 text-sm text-[#44403C]">
          Memuat halaman masuk...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

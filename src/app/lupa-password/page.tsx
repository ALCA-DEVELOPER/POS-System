"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { EnvelopeSimple, MagicWand, WarningCircle, CheckCircle } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"reset" | "magic">("reset");
  const [loading, setLoading] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSentMessage(null);
    setLoading(true);

    try {
      const supabase = createClient();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) {
          setErrorMsg(error.message);
          return;
        }
        setSentMessage(
          `Tautan atur ulang kata sandi telah dikirim ke ${email}. Periksa inbox atau folder spam Anda.`
        );
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            shouldCreateUser: false,
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        });
        if (error) {
          setErrorMsg(error.message);
          return;
        }
        setSentMessage(
          `Magic Link sekali klik telah dikirim ke ${email}. Buka email Anda untuk masuk langsung.`
        );
      }
    } catch {
      setErrorMsg("Gagal menghubungi server autentikasi. Coba beberapa saat lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="min-h-dvh flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-extrabold text-[#1C1917]">
            Pemulihan Akses Akun
          </h1>
          <p className="text-sm text-[#44403C]">
            Pilih kirim tautan reset kata sandi atau masuk instan via Magic Link email.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass-elevated rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-black/5">
            <button
              type="button"
              onClick={() => setMode("reset")}
              className={`min-h-10 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                mode === "reset"
                  ? "bg-white text-[#14532D] shadow-xs"
                  : "text-[#44403C] hover:text-[#1C1917]"
              }`}
            >
              Reset Kata Sandi
            </button>
            <button
              type="button"
              onClick={() => setMode("magic")}
              className={`min-h-10 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                mode === "magic"
                  ? "bg-white text-[#14532D] shadow-xs"
                  : "text-[#44403C] hover:text-[#1C1917]"
              }`}
            >
              Magic Link Email
            </button>
          </div>

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

          {sentMessage ? (
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
              <span>{sentMessage}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-semibold text-[#1C1917]">
              Email Terdaftar
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@usaha.com"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-3 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
          >
            {mode === "reset" ? (
              <EnvelopeSimple size={18} weight="bold" aria-hidden="true" />
            ) : (
              <MagicWand size={18} weight="bold" aria-hidden="true" />
            )}
            {loading
              ? "Mengirim tautan..."
              : mode === "reset"
                ? "Kirim Tautan Reset Sandi"
                : "Kirim Magic Link Masuk"}
          </button>

          <p className="text-center text-xs sm:text-sm text-[#44403C]">
            Ingat kata sandi?{" "}
            <Link href="/login" className="font-bold text-[#14532D] hover:underline">
              Kembali ke Halaman Masuk
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

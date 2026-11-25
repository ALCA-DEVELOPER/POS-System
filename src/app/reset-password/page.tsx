"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Key, WarningCircle } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg("Kata sandi baru minimal 8 karakter.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Konfirmasi kata sandi belum cocok.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErrorMsg("Gagal memperbarui kata sandi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="min-h-dvh flex items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="glass-elevated max-w-md w-full rounded-2xl p-6 space-y-4"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-extrabold text-[#1C1917]">Buat Kata Sandi Baru</h1>
          <p className="text-sm text-[#44403C]">
            Masukkan kata sandi baru untuk akun KulinerKas Anda.
          </p>
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

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-semibold text-[#1C1917]">
            Kata Sandi Baru
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 karakter"
            className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm" className="block text-sm font-semibold text-[#1C1917]">
            Ulangi Kata Sandi Baru
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Ketik ulang kata sandi"
            className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-3 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
        >
          <Key size={18} weight="bold" aria-hidden="true" />
          {loading ? "Menyimpan..." : "Simpan Kata Sandi Baru"}
        </button>
      </form>
    </main>
  );
}

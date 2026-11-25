import { Database } from "@phosphor-icons/react/dist/ssr";

/** Tampilan panduan saat tabel database Supabase belum dibuat via SQL Editor. */
export function SchemaMissingNotice() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="glass-elevated max-w-2xl w-full rounded-2xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] text-[#92400E] flex items-center justify-center">
            <Database size={24} weight="duotone" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1C1917]">
              Skema Database Supabase Belum Dijalankan
            </h1>
            <p className="text-xs sm:text-sm text-[#44403C]">
              Tabel dan kebijakan RLS perlu dibuat satu kali di Supabase SQL Editor.
            </p>
          </div>
        </div>

        <ol className="list-decimal list-inside space-y-2 text-sm text-[#1C1917] leading-relaxed">
          <li>
            Buka Dashboard Supabase proyek Anda, lalu masuk ke menu{" "}
            <span className="font-semibold">SQL Editor</span>.
          </li>
          <li>
            Salin seluruh isi file{" "}
            <code className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-semibold">
              supabase/migrations/001_initial_schema.sql
            </code>
            .
          </li>
          <li>
            Tempel dan klik <span className="font-semibold">Run</span>, lalu muat ulang
            halaman ini.
          </li>
        </ol>
      </div>
    </main>
  );
}

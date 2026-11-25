"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CheckCircle,
  FloppyDisk,
  PencilSimple,
  Plus,
  QrCode,
  Storefront,
  Trash,
  UploadSimple,
  UsersThree,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { broadcastBusinessUpdate } from "@/lib/realtime";
import type { Profile, UserRole } from "@/types/database";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/StatePanel";

export interface StaffMember {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string;
  email?: string;
  is_active: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  cashier: "Kasir",
  kitchen: "Staf Dapur",
};

interface BusinessSettingsClientProps {
  initialProfile: Profile;
  initialStaff: StaffMember[];
  currentUserId: string;
  currentUserEmail: string;
}

export function BusinessSettingsClient({
  initialProfile,
  initialStaff,
  currentUserId,
  currentUserEmail,
}: BusinessSettingsClientProps) {
  const router = useRouter();
  const isCurrentPrimaryFounder = currentUserId === initialProfile.business_id;
  const [businessName, setBusinessName] = useState(initialProfile.business_name);
  const [ownerName, setOwnerName] = useState(initialProfile.owner_name);
  const [phone, setPhone] = useState(initialProfile.phone);
  const [address, setAddress] = useState(initialProfile.address);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialProfile.logo_url);
  const [qrisUrl, setQrisUrl] = useState<string | null>(initialProfile.qris_image_url);
  const [bankName, setBankName] = useState(initialProfile.bank_name);
  const [bankAccount, setBankAccount] = useState(initialProfile.bank_account_number);
  const [bankHolder, setBankHolder] = useState(initialProfile.bank_account_holder);
  const [taxRate, setTaxRate] = useState(String(initialProfile.tax_rate ?? 0));
  const [serviceRate, setServiceRate] = useState(
    String(initialProfile.service_charge_rate ?? 0)
  );

  const [saving, setSaving] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState<"logo" | "qris" | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  // Staff list & Create/Edit/Delete modals
  const [staff, setStaff] = useState<StaffMember[]>(initialStaff);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffPhone, setStaffPhone] = useState("");
  const [staffRole, setStaffRole] = useState<UserRole>("cashier");
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [deletingStaff, setDeletingStaff] = useState(false);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const handleAssetUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    kind: "logo" | "qris"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAsset(kind);
    setFeedback(null);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const filePath = `${initialProfile.business_id}/${kind}-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("store-assets")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) {
        setFeedback({ type: "err", text: `Gagal mengunggah gambar: ${uploadErr.message}` });
        return;
      }

      const { data: pub } = supabase.storage.from("store-assets").getPublicUrl(filePath);
      const url = pub.publicUrl;

      if (kind === "logo") setLogoUrl(url);
      else setQrisUrl(url);

      const updateField = kind === "logo" ? { logo_url: url } : { qris_image_url: url };
      await supabase
        .from("profiles")
        .update(updateField)
        .eq("id", initialProfile.business_id);

      void broadcastBusinessUpdate(initialProfile.business_id, "settings");
      router.refresh();

      setFeedback({
        type: "ok",
        text: kind === "logo" ? "Logo usaha berhasil diperbarui." : "QRIS toko berhasil diperbarui.",
      });
    } catch {
      setFeedback({ type: "err", text: "Terjadi kesalahan saat mengunggah file." });
    } finally {
      setUploadingAsset(null);
      e.target.value = "";
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          business_name: businessName.trim(),
          owner_name: ownerName.trim(),
          full_name: ownerName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          bank_name: bankName.trim(),
          bank_account_number: bankAccount.trim(),
          bank_account_holder: bankHolder.trim(),
          tax_rate: Math.max(0, Math.min(100, Number(taxRate) || 0)),
          service_charge_rate: Math.max(0, Math.min(100, Number(serviceRate) || 0)),
        })
        .eq("id", initialProfile.business_id);

      if (error) {
        setFeedback({ type: "err", text: error.message });
        return;
      }

      void broadcastBusinessUpdate(initialProfile.business_id, "settings");
      router.refresh();
      setFeedback({ type: "ok", text: "Profil bisnis & pengaturan pembayaran tersimpan." });
    } catch {
      setFeedback({ type: "err", text: "Gagal menyimpan pengaturan bisnis." });
    } finally {
      setSaving(false);
    }
  };

  const openCreateStaffModal = () => {
    setEditingStaff(null);
    setStaffName("");
    setStaffEmail("");
    setStaffPassword("");
    setStaffPhone("");
    setStaffRole("cashier");
    setStaffError(null);
    setStaffModalOpen(true);
  };

  const openEditStaffModal = (member: StaffMember) => {
    setEditingStaff(member);
    setStaffName(member.full_name);
    setStaffEmail(member.email ?? "");
    setStaffPassword("");
    setStaffPhone(member.phone ?? "");
    setStaffRole(member.role);
    setStaffError(null);
    setStaffModalOpen(true);
  };

  const handleSaveStaff = async (e: FormEvent) => {
    e.preventDefault();
    setStaffError(null);
    setStaffSubmitting(true);

    try {
      if (editingStaff) {
        const res = await fetch(`/api/staff/${editingStaff.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: staffName,
            phone: staffPhone,
            role: staffRole,
            ...(staffPassword.trim() ? { password: staffPassword } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setStaffError(json.error ?? "Gagal memperbarui akun staf");
          return;
        }

        setStaff((prev) =>
          prev.map((m) =>
            m.id === editingStaff.id
              ? {
                  ...m,
                  full_name: json.staff.full_name,
                  phone: json.staff.phone,
                  role: json.staff.role,
                }
              : m
          )
        );
        setStaffModalOpen(false);
        setFeedback({
          type: "ok",
          text: `Data dan role akun ${json.staff.full_name} berhasil diperbarui.`,
        });
      } else {
        const res = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: staffName,
            email: staffEmail,
            password: staffPassword,
            phone: staffPhone,
            role: staffRole,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setStaffError(json.error ?? "Gagal menambah akun staf");
          return;
        }

        setStaff((prev) => [
          {
            id: json.staff.id,
            full_name: json.staff.full_name,
            role: json.staff.role,
            phone: json.staff.phone,
            email: json.staff.email,
            is_active: true,
            created_at: json.staff.created_at ?? new Date().toISOString(),
          },
          ...prev,
        ]);
        setStaffModalOpen(false);
        setFeedback({
          type: "ok",
          text: `Akun ${json.staff.full_name} (${ROLE_LABELS[json.staff.role as UserRole]}) berhasil ditambahkan.`,
        });
      }
    } catch {
      setStaffError("Gangguan jaringan saat menyimpan data staf.");
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleToggleStaff = async (member: StaffMember) => {
    setFeedback(null);
    const res = await fetch(`/api/staff/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !member.is_active }),
    });
    const json = await res.json();
    if (!res.ok) {
      setFeedback({ type: "err", text: json.error ?? "Gagal mengubah status akun." });
      return;
    }
    setStaff((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, is_active: !m.is_active } : m))
    );
  };

  const confirmDeleteStaff = async () => {
    if (!deleteTarget) return;
    setDeletingStaff(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "err", text: json.error ?? "Gagal menghapus akun staf." });
        return;
      }
      setStaff((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setFeedback({
        type: "ok",
        text: `Akun ${deleteTarget.full_name} berhasil dihapus.`,
      });
      setDeleteTarget(null);
    } catch {
      setFeedback({ type: "err", text: "Terjadi gangguan saat menghapus akun staf." });
    } finally {
      setDeletingStaff(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {feedback ? (
        <div
          role={feedback.type === "err" ? "alert" : "status"}
          className={`rounded-2xl px-4 py-3 text-sm flex items-start gap-2.5 border ${
            feedback.type === "ok"
              ? "border-[#14532D]/30 bg-emerald-50/90 text-[#1C1917]"
              : "border-[#B91C1C]/30 bg-red-50/90 text-[#1C1917]"
          }`}
        >
          {feedback.type === "ok" ? (
            <CheckCircle
              size={20}
              weight="bold"
              className="shrink-0 text-[#14532D]"
              aria-hidden="true"
            />
          ) : (
            <WarningCircle
              size={20}
              weight="bold"
              className="shrink-0 text-[#B91C1C]"
              aria-hidden="true"
            />
          )}
          <span>{feedback.text}</span>
        </div>
      ) : null}

      <form onSubmit={handleSaveProfile} className="space-y-6">
        <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <Storefront size={22} weight="duotone" className="text-[#14532D]" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              Profil Usaha & Struk
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-20 h-20 rounded-2xl border border-[#1C1917]/15 bg-white/80 overflow-hidden flex items-center justify-center shrink-0">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt="Logo usaha"
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-lg font-extrabold text-[#14532D]">KK</span>
              )}
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="logo-upload"
                className="min-h-10 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-white"
              >
                <UploadSimple size={16} weight="bold" aria-hidden="true" />
                {uploadingAsset === "logo" ? "Mengunggah logo..." : "Unggah Logo Usaha"}
              </label>
              <input
                id="logo-upload"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => handleAssetUpload(e, "logo")}
              />
              <p className="text-xs text-[#44403C]">
                Format PNG/JPG, dipakai pada kop laporan PDF & tampilan struk digital.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="businessName" className="block text-sm font-semibold text-[#1C1917]">
                Nama Usaha / Resto
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ownerName" className="block text-sm font-semibold text-[#1C1917]">
                Nama Pemilik Utama (Owner)
              </label>
              <input
                id="ownerName"
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="phone" className="block text-sm font-semibold text-[#1C1917]">
                No. WhatsApp Usaha
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812xxxxxxxx"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="address" className="block text-sm font-semibold text-[#1C1917]">
                Alamat Outlet (untuk Struk)
              </label>
              <input
                id="address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Jl. Merdeka No. 12, Kota"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <QrCode size={22} weight="duotone" className="text-[#14532D]" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              QRIS Statis, Rekening Bank & Pajak POS
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-24 h-24 rounded-2xl border border-[#1C1917]/15 bg-white/85 overflow-hidden flex items-center justify-center shrink-0">
              {qrisUrl ? (
                <Image
                  src={qrisUrl}
                  alt="QRIS statis toko"
                  width={96}
                  height={96}
                  className="w-full h-full object-contain"
                />
              ) : (
                <QrCode size={36} className="text-[#44403C]" aria-hidden="true" />
              )}
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="qris-upload"
                className="min-h-10 inline-flex items-center gap-2 rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-white"
              >
                <UploadSimple size={16} weight="bold" aria-hidden="true" />
                {uploadingAsset === "qris" ? "Mengunggah QRIS..." : "Unggah Gambar QRIS Toko"}
              </label>
              <input
                id="qris-upload"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => handleAssetUpload(e, "qris")}
              />
              <p className="text-xs text-[#44403C]">
                Ditampilkan di layar kasir saat pelanggan memilih bayar via QRIS.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="bankName" className="block text-sm font-semibold text-[#1C1917]">
                Nama Bank
              </label>
              <input
                id="bankName"
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="BCA / BRI / Mandiri"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bankAccount" className="block text-sm font-semibold text-[#1C1917]">
                Nomor Rekening
              </label>
              <input
                id="bankAccount"
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="Nomor rekening transfer"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bankHolder" className="block text-sm font-semibold text-[#1C1917]">
                Atas Nama
              </label>
              <input
                id="bankHolder"
                type="text"
                value={bankHolder}
                onChange={(e) => setBankHolder(e.target.value)}
                placeholder="Nama pemilik rekening"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="taxRate" className="block text-sm font-semibold text-[#1C1917]">
                Pajak Resto / PB1 Default (%)
              </label>
              <input
                id="taxRate"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="serviceRate" className="block text-sm font-semibold text-[#1C1917]">
                Biaya Servis Default (%)
              </label>
              <input
                id="serviceRate"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={serviceRate}
                onChange={(e) => setServiceRate(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white/85 px-3.5 py-2.5 text-sm text-[#1C1917] tabular-nums"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#14532D] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60 transition-colors"
            >
              <FloppyDisk size={18} weight="bold" aria-hidden="true" />
              {saving ? "Menyimpan..." : "Simpan Pengaturan Bisnis"}
            </button>
          </div>
        </section>
      </form>

      {/* Staff Management (Flexible Role: Owner / Cashier / Kitchen) */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <UsersThree size={22} weight="duotone" className="text-[#14532D]" aria-hidden="true" />
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
                Manajemen Tim & Hak Akses
              </h2>
              <p className="text-xs text-[#44403C]">
                Tambah dan ubah peran anggota tim secara fleksibel (Owner, Kasir, atau Staf Dapur).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateStaffModal}
            className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#B43D0A] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#9A3412] transition-colors"
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
            Tambah Anggota Tim
          </button>
        </div>

        {staff.length === 0 ? (
          <EmptyState
            title="Belum ada akun tim tambahan"
            description="Anda tetap dapat mengoperasikan kasir, stok, dan laporan langsung sebagai Owner. Tambahkan akun Co-Owner, Kasir, atau Staf Dapur kapan pun dibutuhkan."
          />
        ) : (
          <div className="space-y-2.5">
            {staff.map((member) => {
              const isPrimaryFounder = member.id === initialProfile.business_id;
              return (
                <div
                  key={member.id}
                  className="rounded-xl border border-[#1C1917]/10 bg-white/75 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#1C1917]">{member.full_name}</p>
                      <span
                        className={`rounded-lg px-2 py-0.5 text-xs font-bold ${
                          member.role === "owner"
                            ? "bg-[#B43D0A]/15 text-[#B43D0A]"
                            : "bg-[#14532D]/10 text-[#14532D]"
                        }`}
                      >
                        {ROLE_LABELS[member.role]}
                      </span>
                      {isPrimaryFounder ? (
                        <span className="rounded-lg bg-black/8 text-[#1C1917] px-2 py-0.5 text-[11px] font-semibold">
                          Pemilik Utama
                        </span>
                      ) : null}
                      <span
                        className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${
                          member.is_active
                            ? "bg-emerald-100 text-[#14532D]"
                            : "bg-stone-200 text-[#44403C]"
                        }`}
                      >
                        {member.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <p className="text-xs text-[#44403C] truncate">
                      {[member.email, member.phone || "Tanpa nomor telepon"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  {!isPrimaryFounder ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => openEditStaffModal(member)}
                        className="min-h-10 inline-flex items-center gap-1.5 rounded-xl border border-[#14532D]/30 bg-white px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-emerald-50"
                      >
                        <PencilSimple size={14} weight="bold" aria-hidden="true" />
                        Edit / Ubah Role
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStaff(member)}
                        className="min-h-10 rounded-xl border border-[#1C1917]/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-black/5"
                      >
                        {member.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(member)}
                        aria-label={`Hapus akun ${member.full_name}`}
                        className="min-h-10 min-w-10 rounded-xl border border-[#B91C1C]/25 text-[#B91C1C] inline-flex items-center justify-center hover:bg-red-50"
                      >
                        <Trash size={16} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal Tambah / Edit Staf */}
      <Modal
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        title={editingStaff ? `Edit Akun: ${editingStaff.full_name}` : "Tambah Anggota Tim"}
        description="Atur role menjadi Owner (akses penuh), Kasir (hanya POS & shift), atau Staf Dapur (stok & waste)."
      >
        <form onSubmit={handleSaveStaff} className="space-y-4">
          {staffError ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2.5 text-xs text-[#1C1917] flex items-center gap-2"
            >
              <WarningCircle size={16} className="text-[#B91C1C] shrink-0" aria-hidden="true" />
              <span>{staffError}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="staffName" className="block text-sm font-semibold text-[#1C1917]">
              Nama Lengkap
            </label>
            <input
              id="staffName"
              type="text"
              required
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Nama anggota tim"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="staffRole" className="block text-sm font-semibold text-[#1C1917]">
              Hak Akses Role
            </label>
            <select
              id="staffRole"
              value={staffRole}
              onChange={(e) => setStaffRole(e.target.value as UserRole)}
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            >
              <option value="owner">Owner / Co-Owner (Akses Penuh Keuangan, Menu, POS, & Staf)</option>
              <option value="cashier">Kasir / Staf Depan (Hanya POS & Buka/Tutup Shift)</option>
              <option value="kitchen">Staf Dapur / Produksi (Hanya Stok Bahan & Waste)</option>
            </select>
          </div>

          {!editingStaff ? (
            <div className="space-y-1.5">
              <label htmlFor="staffEmail" className="block text-sm font-semibold text-[#1C1917]">
                Email Login
              </label>
              <input
                id="staffEmail"
                type="email"
                required
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="tim@usaha.com"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              />
            </div>
          ) : staffEmail ? (
            <p className="text-xs text-[#44403C] rounded-xl bg-black/5 px-3 py-2">
              Email akun: <strong className="text-[#1C1917]">{staffEmail}</strong>
            </p>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="staffPhone" className="block text-sm font-semibold text-[#1C1917]">
                No. WhatsApp
              </label>
              <input
                id="staffPhone"
                type="tel"
                value={staffPhone}
                onChange={(e) => setStaffPhone(e.target.value)}
                placeholder="0812xxxxxxxx"
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="staffPassword" className="block text-sm font-semibold text-[#1C1917]">
                {editingStaff ? "Kata Sandi Baru (Opsional)" : "Kata Sandi Awal"}
              </label>
              <input
                id="staffPassword"
                type="password"
                required={!editingStaff}
                minLength={8}
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder={editingStaff ? "Kosongkan jika tetap" : "Min. 8 karakter"}
                className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStaffModalOpen(false)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 py-2 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={staffSubmitting}
              className="min-h-11 rounded-xl bg-[#14532D] px-5 py-2 text-sm font-bold text-white hover:bg-[#166534] disabled:opacity-60"
            >
              {staffSubmitting
                ? "Menyimpan..."
                : editingStaff
                  ? "Simpan Perubahan"
                  : "Buat Akun"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Konfirmasi Hapus Staf */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Akun Staf?"
        description="Akun yang dihapus tidak lagi bisa masuk ke sistem KulinerKas."
      >
        <div className="space-y-4">
          <p className="text-sm text-[#1C1917]">
            Anda yakin ingin menghapus akun{" "}
            <span className="font-bold">{deleteTarget?.full_name}</span> (
            {deleteTarget ? ROLE_LABELS[deleteTarget.role] : ""})?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deletingStaff}
              onClick={confirmDeleteStaff}
              className="min-h-11 rounded-xl bg-[#B91C1C] px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {deletingStaff ? "Menghapus..." : "Ya, Hapus Akun"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Danger Zone: Hapus Akun Permanen */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 border-[#B91C1C]/30 bg-red-50/45 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
            <Warning size={20} weight="bold" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#1C1917]">
              {isCurrentPrimaryFounder
                ? "Hapus Akun & Seluruh Data Bisnis"
                : "Hapus Akun Pribadi Saya"}
            </h2>
            <p className="text-xs sm:text-sm text-[#44403C] leading-relaxed">
              {isCurrentPrimaryFounder
                ? `Menghapus seluruh data usaha "${businessName || "KulinerKas"}" secara permanen (menu, resep HPP, stok bahan, transaksi kasir, shift, pengeluaran, foto struk/logo/QRIS, serta seluruh akun tim) dan menghapus akun login (${currentUserEmail}).`
                : `Menghapus akun pribadi Anda (${currentUserEmail}) secara permanen tanpa menghapus data bisnis utama.`}
            </p>
            <p className="text-xs font-semibold text-[#14532D]">
              Setelah dihapus, alamat email {currentUserEmail} langsung bebas dan bisa dipakai
              kembali untuk mendaftarkan bisnis baru.
            </p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmText("");
              setDeleteAccountError(null);
              setDeleteAccountOpen(true);
            }}
            className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#B91C1C] px-4 py-2.5 text-sm font-bold text-white hover:bg-red-800 transition-colors"
          >
            <Trash size={17} weight="bold" aria-hidden="true" />
            {isCurrentPrimaryFounder ? "Hapus Akun & Bisnis Permanen" : "Hapus Akun Saya"}
          </button>
        </div>
      </section>

      <Modal
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        title={
          isCurrentPrimaryFounder
            ? "Konfirmasi Hapus Akun & Seluruh Bisnis"
            : "Konfirmasi Hapus Akun Pribadi"
        }
        description="Data yang dihapus tidak bisa dipulihkan kembali."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (deleteConfirmText.trim() !== "HAPUS PERMANEN") {
              setDeleteAccountError('Ketik tepat "HAPUS PERMANEN" untuk melanjutkan.');
              return;
            }
            setDeletingAccount(true);
            setDeleteAccountError(null);
            try {
              const res = await fetch("/api/account", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmation: deleteConfirmText.trim() }),
              });
              const json = await res.json();
              if (!res.ok) {
                setDeleteAccountError(json.error ?? "Gagal menghapus akun.");
                return;
              }
              try {
                window.localStorage.removeItem(
                  `kulinerkas_pos_menu_${initialProfile.business_id}`
                );
              } catch {
                // Ignore storage errors
              }
              setDeleteAccountOpen(false);
              router.replace("/register?deleted=1");
              router.refresh();
            } catch {
              setDeleteAccountError("Gangguan jaringan saat menghapus akun.");
            } finally {
              setDeletingAccount(false);
            }
          }}
          className="space-y-4"
        >
          {deleteAccountError ? (
            <div
              role="alert"
              className="rounded-xl border border-[#B91C1C]/30 bg-red-50 px-3 py-2.5 text-xs text-[#1C1917] flex items-center gap-2"
            >
              <WarningCircle size={16} className="text-[#B91C1C] shrink-0" aria-hidden="true" />
              <span>{deleteAccountError}</span>
            </div>
          ) : null}

          {isCurrentPrimaryFounder ? (
            <ul className="list-disc list-inside text-xs sm:text-sm text-[#1C1917] space-y-1 bg-black/5 rounded-xl p-3.5">
              <li>Seluruh menu, komposisi resep HPP, dan stok bahan baku hilang permanen.</li>
              <li>Seluruh riwayat transaksi kasir, shift, dan laporan P&L hilang permanen.</li>
              <li>Seluruh catatan pengeluaran beserta foto struk, logo, dan QRIS di Storage ikut terhapus.</li>
              <li>Seluruh akun tim (Co-Owner, Kasir, Staf Dapur) di bisnis ini ikut terhapus.</li>
              <li>Email <strong>{currentUserEmail}</strong> langsung bebas dan bisa dipakai mendaftar bisnis baru lagi.</li>
            </ul>
          ) : (
            <p className="text-sm text-[#1C1917]">
              Akun Anda (<strong>{currentUserEmail}</strong>) akan dihapus permanen dan email
              Anda bisa langsung dipakai lagi untuk mendaftarkan bisnis baru.
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="deleteConfirm" className="block text-xs sm:text-sm font-semibold text-[#1C1917]">
              Ketik <span className="font-extrabold text-[#B91C1C]">HAPUS PERMANEN</span> untuk
              konfirmasi
            </label>
            <input
              id="deleteConfirm"
              type="text"
              required
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="HAPUS PERMANEN"
              className="min-h-11 w-full rounded-xl border border-[#1C1917]/20 bg-white px-3.5 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteAccountOpen(false)}
              className="min-h-11 rounded-xl border border-[#1C1917]/15 px-4 text-sm font-semibold text-[#1C1917]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={deletingAccount || deleteConfirmText.trim() !== "HAPUS PERMANEN"}
              className="min-h-11 rounded-xl bg-[#B91C1C] px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {deletingAccount ? "Menghapus semua data..." : "Hapus Permanen Sekarang"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

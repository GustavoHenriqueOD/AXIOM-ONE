"use client";

import { useState, FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CurrencyManager } from "./CurrencyManager";
import { toast } from "@/lib/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Moon,
  Globe,
  DollarSign,
  Bell,
  Download,
  Upload,
  Trash2,
  Shield,
  ChevronRight,
  Camera,
} from "lucide-react";
import type { UserCurrency } from "@/generated/prisma/client";

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "pt-BR", label: "Português (BR)", flag: "🇧🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
];

interface NotifPrefs {
  notifTransactions: boolean;
  notifBudgetAlerts: boolean;
  notifMonthlyReport: boolean;
}

interface SettingsPageProps {
  user: { id: string; name: string | null; email: string; image: string | null };
  currencies: UserCurrency[];
  currentTheme: "dark" | "light";
  currentLocale: string;
  notifPrefs: NotifPrefs;
}

export function SettingsPage({
  user,
  currencies,
  currentTheme,
  currentLocale,
  notifPrefs,
}: SettingsPageProps) {
  const router = useRouter();
  const t = useTranslations("Settings");

  // Profile state
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.image);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/avatar", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.imageUrl + "?t=" + Date.now());
        router.refresh();
      } else {
        toast.error("Erro", data.error ?? "Não foi possível enviar a imagem");
      }
    } catch {
      toast.error("Erro", t("connectionError"));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Appearance state
  const [isDark, setIsDark] = useState(currentTheme === "dark");
  const [locale, setLocale] = useState(currentLocale);

  // Notification prefs state
  const [notifTx, setNotifTx] = useState(notifPrefs.notifTransactions);
  const [notifBudget, setNotifBudget] = useState(notifPrefs.notifBudgetAlerts);
  const [notifMonthly, setNotifMonthly] = useState(notifPrefs.notifMonthlyReport);

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Sucesso!", t("saveSuccess"));
        router.refresh();
      } else {
        toast.error("Erro", data.error ?? t("saveError"));
      }
    } catch {
      toast.error("Erro", t("connectionError"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Erro", t("passwordMismatch"));
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Sucesso!", t("passwordSuccess"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast.error("Erro", data.error ?? t("passwordError"));
      }
    } catch {
      toast.error("Erro", t("connectionError"));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleThemeToggle(checked: boolean) {
    setIsDark(checked);
    const theme = checked ? "dark" : "light";
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      // Apply class immediately on <html> for instant feedback
      if (typeof document !== "undefined") {
        if (checked) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    } catch {
      setIsDark(!checked); // revert
    }
  }

  async function handleLocaleChange(newLocale: string | null) {
    if (!newLocale) return;
    setLocale(newLocale);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: newLocale }),
      });
      router.refresh();
    } catch {
      setLocale(locale); // revert
    }
  }

  async function handleNotifChange(field: keyof NotifPrefs, value: boolean) {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      // revert on error
      if (field === "notifTransactions") setNotifTx(!value);
      if (field === "notifBudgetAlerts") setNotifBudget(!value);
      if (field === "notifMonthlyReport") setNotifMonthly(!value);
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Profile Settings ── */}
      <section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
        <h2 className="text-white font-semibold text-base mb-6">{t("profileSectionTitle")}</h2>
        <form onSubmit={handleProfileSave}>
          {/* Avatar + fields */}
          <div className="flex items-start gap-6 mb-6">
            {/* Avatar clicável */}
            <div className="shrink-0 relative group">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="w-20 h-20 rounded-full overflow-hidden bg-axiom-hover border border-axiom-border flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-axiom-primary"
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <User size={32} className="text-axiom-muted" />
                )}
                {/* Overlay hover */}
                <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {uploadingAvatar ? (
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera size={18} className="text-white" />
                  )}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            {/* Name + Email side by side */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-axiom-muted text-sm">
                  {t("nameLabel")}
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-axiom-hover border-axiom-border text-white placeholder:text-axiom-muted focus:border-axiom-primary"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-axiom-muted text-sm">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-axiom-hover border-axiom-border text-white placeholder:text-axiom-muted focus:border-axiom-primary"
                />
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={savingProfile}
            className="bg-axiom-primary hover:bg-axiom-primary/90 text-white"
          >
            {savingProfile ? t("savingChangesButton") : t("saveChangesButton")}
          </Button>
        </form>
      </section>

      {/* ── Appearance ── */}
      <section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
        <h2 className="text-white font-semibold text-base mb-6">{t("appearanceTitle")}</h2>
        <div className="space-y-4">
          {/* Dark Mode */}
          <div className="flex items-center justify-between py-3 border-b border-axiom-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-axiom-hover flex items-center justify-center shrink-0">
                <Moon size={16} className="text-axiom-muted" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">{t("darkModeLabel")}</p>
                <p className="text-axiom-muted text-xs">{t("darkModeDesc")}</p>
              </div>
            </div>
            <Switch
              checked={isDark}
              onCheckedChange={handleThemeToggle}
              className="data-[state=checked]:bg-axiom-primary"
            />
          </div>

          {/* Language */}
          <div className="flex items-center justify-between py-3 border-b border-axiom-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-axiom-hover flex items-center justify-center shrink-0">
                <Globe size={16} className="text-axiom-muted" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">{t("languageLabel")}</p>
              </div>
            </div>
            <Select value={locale} onValueChange={handleLocaleChange}>
              <SelectTrigger className="w-44 bg-axiom-hover border-axiom-border text-white text-sm focus:ring-axiom-primary">
                <SelectValue>
                  {(() => { const l = LANGUAGE_OPTIONS.find((o) => o.code === locale); return l ? `${l.flag} ${l.label}` : locale; })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-axiom-card border-axiom-border text-white">
                {LANGUAGE_OPTIONS.map((lang) => (
                  <SelectItem
                    key={lang.code}
                    value={lang.code}
                    className="text-axiom-muted focus:bg-axiom-hover focus:text-white cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Currency */}
          <div className="py-3">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-axiom-hover flex items-center justify-center shrink-0">
                <DollarSign size={16} className="text-axiom-muted" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">{t("currenciesTitle")}</p>
                <p className="text-axiom-muted text-xs">{t("currenciesDesc")}</p>
              </div>
            </div>
            <CurrencyManager initialCurrencies={currencies} />
          </div>
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Bell size={16} className="text-axiom-muted" />
          <h2 className="text-white font-semibold text-base">{t("notificationsTitle")}</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-axiom-border">
            <div>
              <p className="text-white text-sm font-medium">{t("emailNotificationsLabel")}</p>
              <p className="text-axiom-muted text-xs mt-0.5">{t("emailNotificationsDesc")}</p>
            </div>
            <Switch
              checked={notifTx}
              onCheckedChange={(v) => { setNotifTx(v); handleNotifChange("notifTransactions", v); }}
              className="data-[state=checked]:bg-axiom-primary"
            />
          </div>
          <div className="flex items-center justify-between py-3 border-b border-axiom-border">
            <div>
              <p className="text-white text-sm font-medium">{t("budgetAlertsLabel")}</p>
              <p className="text-axiom-muted text-xs mt-0.5">{t("budgetAlertsDesc")}</p>
            </div>
            <Switch
              checked={notifBudget}
              onCheckedChange={(v) => { setNotifBudget(v); handleNotifChange("notifBudgetAlerts", v); }}
              className="data-[state=checked]:bg-axiom-primary"
            />
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-white text-sm font-medium">{t("monthlyReportsLabel")}</p>
              <p className="text-axiom-muted text-xs mt-0.5">{t("monthlyReportsDesc")}</p>
            </div>
            <Switch
              checked={notifMonthly}
              onCheckedChange={(v) => { setNotifMonthly(v); handleNotifChange("notifMonthlyReport", v); }}
              className="data-[state=checked]:bg-axiom-primary"
            />
          </div>
        </div>
      </section>

      {/* ── Data & Backup ── */}
      <section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
        <h2 className="text-white font-semibold text-base mb-6">{t("dataTitle")}</h2>
        <div className="space-y-1">
          <button
            disabled
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-axiom-hover transition-colors text-left group opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center gap-3">
              <Download size={16} className="text-axiom-muted" />
              <div>
                <p className="text-white text-sm font-medium">{t("exportDataLabel")}</p>
                <p className="text-axiom-muted text-xs">{t("exportDataDesc")}</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-axiom-muted" />
          </button>
          <button
            disabled
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-axiom-hover transition-colors text-left group opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center gap-3">
              <Upload size={16} className="text-axiom-muted" />
              <div>
                <p className="text-white text-sm font-medium">{t("importDataLabel")}</p>
                <p className="text-axiom-muted text-xs">{t("importDataDesc")}</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-axiom-muted" />
          </button>
          <button
            disabled
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left group opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center gap-3">
              <Trash2 size={16} className="text-axiom-expense" />
              <div>
                <p className="text-axiom-expense text-sm font-medium">{t("deleteAllDataLabel")}</p>
                <p className="text-axiom-muted text-xs">{t("deleteAllDataDesc")}</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-axiom-muted" />
          </button>
        </div>
      </section>

      {/* ── Security ── */}
      <section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Shield size={16} className="text-axiom-muted" />
          <h2 className="text-white font-semibold text-base">{t("securityTitle")}</h2>
        </div>
        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword" className="text-axiom-muted text-sm">
              {t("currentPasswordLabel")}
            </Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-axiom-hover border-axiom-border text-white focus:border-axiom-primary"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="text-axiom-muted text-sm">
                {t("newPasswordLabel")}
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-axiom-hover border-axiom-border text-white focus:border-axiom-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-axiom-muted text-sm">
                {t("confirmPasswordLabel")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-axiom-hover border-axiom-border text-white focus:border-axiom-primary"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={savingPassword}
            className="bg-axiom-primary hover:bg-axiom-primary/90 text-white"
          >
            {savingPassword ? t("updatingPasswordButton") : t("updatePasswordButton")}
          </Button>
        </form>
      </section>

    </div>
  );
}

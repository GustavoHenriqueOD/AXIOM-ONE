"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { Moon, Sun, Bell, LogOut, User, CheckCheck, Wallet, TriangleAlert, CalendarRange, Info } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

interface TopbarProps {
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
}

interface Notification {
  id: string;
  type: "TRANSACTION" | "BUDGET_ALERT" | "MONTHLY_REPORT" | "SYSTEM";
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

function NotificationIcon({ type }: { type: Notification["type"] }) {
  if (type === "TRANSACTION") return <Wallet size={14} className="text-axiom-primary shrink-0" />;
  if (type === "BUDGET_ALERT") return <TriangleAlert size={14} className="text-axiom-expense shrink-0" />;
  if (type === "MONTHLY_REPORT") return <CalendarRange size={14} className="text-axiom-income shrink-0" />;
  return <Info size={14} className="text-axiom-muted shrink-0" />;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function Topbar({ userName, userEmail, userImage }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("Topbar");
  const title = t(`pageTitles.${pathname}` as Parameters<typeof t>[0]) ?? t("pageTitles./dashboard");
  const initial = userName ? userName.charAt(0).toUpperCase() : "U";

  const [isDark, setIsDark] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  async function handleThemeToggle() {
    const next = isDark ? "light" : "dark";
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
    setIsDark(!isDark);
    router.refresh();
  }

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleMarkAllRead() {
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function handleMarkRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-axiom-border">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-axiom-muted text-sm">{t("subtitle")}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleThemeToggle}
          className="w-9 h-9 flex items-center justify-center rounded-full text-axiom-muted hover:text-white hover:bg-axiom-hover transition-colors"
          title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notification Bell */}
        <DropdownMenu open={notifOpen} onOpenChange={(open) => {
          setNotifOpen(open);
          if (open) fetchNotifications();
        }}>
          <DropdownMenuTrigger className="relative w-9 h-9 flex items-center justify-center rounded-full text-axiom-muted hover:text-white hover:bg-axiom-hover transition-colors focus:outline-none">
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-axiom-primary rounded-full text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-80 bg-axiom-card border-axiom-border text-white p-0"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-axiom-border">
              <span className="text-white text-sm font-semibold">Notificações</span>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-axiom-muted hover:text-white text-xs transition-colors"
                >
                  <CheckCheck size={12} />
                  Marcar todas como lida
                </button>
              )}
            </div>

            {/* Notification list */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-axiom-muted text-sm">
                  Nenhuma notificação
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => !n.read && handleMarkRead(n.id)}
                    className={`flex gap-3 px-4 py-3 border-b border-axiom-border last:border-0 cursor-pointer hover:bg-axiom-hover transition-colors ${
                      !n.read ? "bg-axiom-primary/5" : ""
                    }`}
                  >
                    <div className="mt-0.5">
                      <NotificationIcon type={n.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium truncate ${!n.read ? "text-white" : "text-axiom-muted"}`}>
                          {n.title}
                        </p>
                        <span className="text-axiom-muted text-xs shrink-0">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="text-axiom-muted text-xs mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                    {!n.read && (
                      <div className="w-1.5 h-1.5 rounded-full bg-axiom-primary mt-1.5 shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full focus:outline-none focus:ring-2 focus:ring-axiom-primary focus:ring-offset-2 focus:ring-offset-axiom-bg">
            <Avatar className="w-9 h-9 bg-axiom-primary cursor-pointer hover:opacity-90 transition-opacity">
              {userImage && <AvatarImage src={userImage} alt={userName ?? "Avatar"} className="object-cover" />}
              <AvatarFallback className="bg-axiom-primary text-white font-semibold text-sm">
                {initial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 bg-axiom-card border-axiom-border text-white"
          >
            {/* User info */}
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar className="w-9 h-9 bg-axiom-primary shrink-0">
                {userImage && <AvatarImage src={userImage} alt={userName ?? "Avatar"} className="object-cover" />}
                <AvatarFallback className="bg-axiom-primary text-white font-semibold text-sm">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                {userName && (
                  <p className="text-white text-sm font-medium truncate">{userName}</p>
                )}
                {userEmail && (
                  <p className="text-axiom-muted text-xs truncate">{userEmail}</p>
                )}
              </div>
            </div>

            <DropdownMenuSeparator className="bg-axiom-border" />

            <DropdownMenuItem
              onClick={() => router.push("/settings")}
              className="text-axiom-muted hover:text-white hover:bg-axiom-hover cursor-pointer gap-2 focus:bg-axiom-hover focus:text-white"
            >
              <User size={14} />
              Configurações
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-axiom-border" />

            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-axiom-expense hover:text-axiom-expense hover:bg-axiom-expense/10 cursor-pointer gap-2 focus:bg-axiom-expense/10 focus:text-axiom-expense"
            >
              <LogOut size={14} />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

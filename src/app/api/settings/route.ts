import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendProfileUpdatedEmail } from "@/lib/email";

const VALID_THEMES = ["dark", "light"] as const;
const VALID_LOCALES = ["en", "pt-BR", "es", "fr", "zh", "hi", "ar"] as const;

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    name,
    email,
    theme,
    locale,
    notifTransactions,
    notifBudgetAlerts,
    notifMonthlyReport,
  } = body;

  const hasProfileChange = name !== undefined || email !== undefined;
  const hasCookieChange = theme !== undefined || locale !== undefined;
  const hasNotifChange =
    notifTransactions !== undefined ||
    notifBudgetAlerts !== undefined ||
    notifMonthlyReport !== undefined;

  // Validate profile fields if present
  if (hasProfileChange) {
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
    }
    if (email !== undefined && (typeof email !== "string" || !email.includes("@") || !email.includes("."))) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }
    if (email !== undefined) {
      const existing = await prisma.user.findFirst({
        where: { email: email.trim(), NOT: { id: session.user.id } },
      });
      if (existing) {
        return NextResponse.json({ error: "Email já está em uso" }, { status: 409 });
      }
    }
  }

  // Validate cookie fields if present
  if (theme !== undefined && !VALID_THEMES.includes(theme)) {
    return NextResponse.json({ error: "Tema inválido" }, { status: 400 });
  }
  if (locale !== undefined && !VALID_LOCALES.includes(locale)) {
    return NextResponse.json({ error: "Locale inválido" }, { status: 400 });
  }

  // Build DB update
  const dbUpdate: Record<string, unknown> = {};
  if (name !== undefined) dbUpdate.name = name.trim();
  if (email !== undefined) dbUpdate.email = email.trim();
  if (typeof notifTransactions === "boolean") dbUpdate.notifTransactions = notifTransactions;
  if (typeof notifBudgetAlerts === "boolean") dbUpdate.notifBudgetAlerts = notifBudgetAlerts;
  if (typeof notifMonthlyReport === "boolean") dbUpdate.notifMonthlyReport = notifMonthlyReport;

  let updatedUser: { id: string; name: string | null; email: string } | null = null;
  if (Object.keys(dbUpdate).length > 0) {
    // Fetch current user before update for email notification
    let currentUser: { name: string | null; email: string } | null = null;
    if (hasProfileChange) {
      currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, email: true },
      });
    }

    updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: dbUpdate,
      select: { id: true, name: true, email: true },
    });

    // Send profile change email only for name/email changes
    if (hasProfileChange && currentUser) {
      const changes: { field: string; label: string }[] = [];
      if (name !== undefined && currentUser.name !== name.trim())
        changes.push({ field: "name", label: "Nome" });
      if (email !== undefined && currentUser.email !== email.trim())
        changes.push({ field: "email", label: "Email" });

      if (changes.length > 0) {
        sendProfileUpdatedEmail({
          to: currentUser.email,
          name: currentUser.name,
          changes,
        }).catch(() => {});
      }
    }
  }

  // Build response with cookies if needed
  const res = NextResponse.json(updatedUser ?? { ok: true });

  if (hasCookieChange) {
    const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
    if (theme !== undefined) res.cookies.set("AXIOM_THEME", theme, cookieOpts);
    if (locale !== undefined) res.cookies.set("NEXT_LOCALE", locale, cookieOpts);
  }

  return res;
}

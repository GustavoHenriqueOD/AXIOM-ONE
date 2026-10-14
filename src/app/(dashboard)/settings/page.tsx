import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { cookies } from "next/headers";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const cookieStore = await cookies();
  const currentTheme = (cookieStore.get("AXIOM_THEME")?.value ?? "dark") as "dark" | "light";
  const currentLocale = cookieStore.get("NEXT_LOCALE")?.value ?? "en";

  const [user, currencies, categories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        notifTransactions: true,
        notifBudgetAlerts: true,
        notifMonthlyReport: true,
      },
    }),
    prisma.userCurrency.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!user) redirect("/login");

  return (
    <SettingsPage
      user={user}
      currencies={currencies}
      currentTheme={currentTheme}
      currentLocale={currentLocale}
      notifPrefs={{
        notifTransactions: user.notifTransactions,
        notifBudgetAlerts: user.notifBudgetAlerts,
        notifMonthlyReport: user.notifMonthlyReport,
      }}
      categories={categories}
    />
  );
}

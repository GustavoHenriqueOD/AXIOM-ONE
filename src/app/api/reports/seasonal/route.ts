import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "EXPENSE" },
    include: { category: true },
    orderBy: { date: "asc" },
  });

  if (transactions.length === 0) {
    return NextResponse.json({ hasEnoughData: false, months: [] });
  }

  // Verificar se tem ≥ 12 meses distintos
  const distinctMonths = new Set(
    transactions.map((tx) => `${tx.date.getFullYear()}-${tx.date.getMonth()}`)
  );

  if (distinctMonths.size < 12) {
    return NextResponse.json({ hasEnoughData: false, months: [] });
  }

  // Para cada mês do calendário (0-11), calcular média de gastos por ano
  const monthData = Array.from({ length: 12 }, (_, monthIndex) => {
    const txInMonth = transactions.filter((tx) => tx.date.getMonth() === monthIndex);

    // Agrupar por ano para calcular média
    const byYear = new Map<number, number>();
    for (const tx of txInMonth) {
      const year = tx.date.getFullYear();
      byYear.set(year, (byYear.get(year) ?? 0) + toNumber(tx.amount));
    }

    const yearTotals = Array.from(byYear.values());
    const avg = yearTotals.length > 0
      ? yearTotals.reduce((a, b) => a + b, 0) / yearTotals.length
      : 0;

    // Top 2 categorias nesse mês (histórico)
    const catMap = new Map<string, { name: string; color: string; total: number }>();
    for (const tx of txInMonth) {
      const key = tx.categoryId;
      const existing = catMap.get(key);
      if (existing) {
        existing.total += toNumber(tx.amount);
      } else {
        catMap.set(key, {
          name: tx.category.name,
          color: tx.category.color,
          total: toNumber(tx.amount),
        });
      }
    }

    const topCategories = Array.from(catMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 2)
      .map(({ name, color }) => ({ name, color }));

    return { monthIndex, name: MONTH_NAMES[monthIndex], avg, topCategories };
  });

  // Calcular variação em relação à média global
  const overallMean =
    monthData.reduce((acc, m) => acc + m.avg, 0) / monthData.length;

  const months = monthData.map((m) => ({
    ...m,
    variationPct:
      overallMean > 0 ? ((m.avg - overallMean) / overallMean) * 100 : 0,
  }));

  return NextResponse.json({ hasEnoughData: true, months });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const catsParam = searchParams.get("cats") ?? "";
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  if (!startParam || !endParam) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }

  const filterEnd = new Date(`${endParam}T23:59:59.999`);
  const filterStart = new Date(`${startParam}T00:00:00`);

  // Categorias solicitadas (máx 3)
  const requestedCats = catsParam
    ? catsParam.split(",").filter(Boolean).slice(0, 3)
    : [];

  // Histórico 12 meses para mean/stdDev
  const histStart = new Date(filterEnd);
  histStart.setMonth(histStart.getMonth() - 11);
  histStart.setDate(1);
  histStart.setHours(0, 0, 0, 0);

  // Buscar todas as categorias EXPENSE do usuário
  const [categories, allHistoryTx] = await Promise.all([
    prisma.category.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        type: "EXPENSE",
        date: { gte: histStart, lte: filterEnd },
      },
    }),
  ]);

  // Para cada categoria solicitada, calcular série mensal
  const series = requestedCats
    .map((catId) => {
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return null;

      // Série do range filtrado por mês
      const rangeMonths = getMonthsInRange(filterStart, filterEnd);
      const monthly = rangeMonths.map(({ start, end, label }) => {
        const monthTx = allHistoryTx.filter(
          (tx) => tx.categoryId === catId && tx.date >= start && tx.date <= end
        );
        const value = monthTx.reduce((acc, tx) => acc + toNumber(tx.amount), 0);
        return { month: label, value };
      });

      // Histórico 12 meses para mean/stdDev
      const histMonths = getMonthsInRange(histStart, filterEnd);
      const histValues = histMonths.map(({ start, end }) => {
        const monthTx = allHistoryTx.filter(
          (tx) => tx.categoryId === catId && tx.date >= start && tx.date <= end
        );
        return monthTx.reduce((acc, tx) => acc + toNumber(tx.amount), 0);
      });

      const mean = histValues.length > 0
        ? histValues.reduce((a, b) => a + b, 0) / histValues.length
        : 0;
      const sd = stdDev(histValues);

      const monthlyWithStats = monthly.map((m) => ({
        ...m,
        mean,
        stdDev: sd,
      }));

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        color: cat.color,
        monthly: monthlyWithStats,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ categories, series });
}

function getMonthsInRange(start: Date, end: Date) {
  const months: { start: Date; end: Date; label: string }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cur <= endMonth) {
    const mStart = new Date(cur);
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
    months.push({
      start: mStart,
      end: mEnd,
      label: cur.toLocaleString("pt-BR", { month: "short", year: "2-digit" }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  return months;
}

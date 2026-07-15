import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: "asc" },
  });

  if (transactions.length === 0) {
    return NextResponse.json({
      months: [],
      currentNetWorth: 0,
      avgSavingsRate: 0,
    });
  }

  // Determinar range de meses (primeiro até hoje)
  const firstDate = transactions[0].date;
  const now = new Date();
  const startYear = firstDate.getFullYear();
  const startMonth = firstDate.getMonth();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth();

  const totalMonths =
    (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

  let cumulativeBalance = 0;
  const months: {
    month: string;
    cumulativeBalance: number;
    monthIncome: number;
    monthExpenses: number;
    savingsRate: number;
  }[] = [];

  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(startYear, startMonth + i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthTx = transactions.filter((tx) => tx.date >= d && tx.date <= mEnd);

    const monthIncome = monthTx
      .filter((tx) => tx.type === "INCOME")
      .reduce((acc, tx) => acc + toNumber(tx.amount), 0);

    const monthExpenses = monthTx
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((acc, tx) => acc + toNumber(tx.amount), 0);

    cumulativeBalance += monthIncome - monthExpenses;

    const savingsRate =
      monthIncome > 0
        ? ((monthIncome - monthExpenses) / monthIncome) * 100
        : 0;

    months.push({
      month: d.toLocaleString("pt-BR", { month: "short", year: "2-digit" }),
      cumulativeBalance,
      monthIncome,
      monthExpenses,
      savingsRate,
    });
  }

  const savingsRates = months
    .filter((m) => m.monthIncome > 0)
    .map((m) => m.savingsRate);

  const avgSavingsRate =
    savingsRates.length > 0
      ? savingsRates.reduce((a, b) => a + b, 0) / savingsRates.length
      : 0;

  return NextResponse.json({
    months,
    currentNetWorth: cumulativeBalance,
    avgSavingsRate,
  });
}

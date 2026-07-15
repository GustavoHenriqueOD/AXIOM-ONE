import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  if (!startParam || !endParam) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }

  const filterEnd = new Date(`${endParam}T23:59:59.999`);
  const filterStart = new Date(`${startParam}T00:00:00`);

  // 6 meses anteriores ao início do período para comparativos
  const historyStart = new Date(filterStart);
  historyStart.setMonth(historyStart.getMonth() - 6);
  historyStart.setDate(1);
  historyStart.setHours(0, 0, 0, 0);

  const [periodTx, historyTx] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: filterStart, lte: filterEnd } },
      include: { category: true },
    }),
    prisma.transaction.findMany({
      where: { userId, date: { gte: historyStart, lt: filterStart } },
      include: { category: true },
    }),
  ]);

  const income = periodTx
    .filter((tx) => tx.type === "INCOME")
    .reduce((acc, tx) => acc + toNumber(tx.amount), 0);

  const expenses = periodTx
    .filter((tx) => tx.type === "EXPENSE")
    .reduce((acc, tx) => acc + toNumber(tx.amount), 0);

  // --- Health Score ---
  let healthScore: number | null = null;
  const pillars: { label: string; value: number; maxPoints: number; earnedPoints: number }[] = [];

  if (income > 0) {
    // Pilar 1: Poupança (40pts)
    const savingsRate = (income - expenses) / income;
    const savingsPoints = Math.min(40, Math.max(0, savingsRate * 200)); // 20% = 40pts
    pillars.push({ label: "Poupança", value: (savingsPoints / 40) * 100, maxPoints: 40, earnedPoints: Math.round(savingsPoints) });

    // Pilar 2: Trend patrimonial (30pts)
    const net = income - expenses;
    const trendPoints = net >= 0 ? 30 : 0;
    pillars.push({ label: "Tendência", value: net >= 0 ? 100 : 0, maxPoints: 30, earnedPoints: trendPoints });

    // Pilar 3: Renda presente (20pts)
    pillars.push({ label: "Renda", value: 100, maxPoints: 20, earnedPoints: 20 });

    // Pilar 4: Controle — despesas abaixo da média dos 3 meses anteriores (10pts)
    const prev3MonthsTx = getLastNMonths(historyTx, filterStart, 3);
    const prev3Expenses = prev3MonthsTx.length > 0
      ? prev3MonthsTx.reduce((acc, m) => acc + m, 0) / prev3MonthsTx.length
      : 0;
    const controlPoints = prev3Expenses === 0 || expenses <= prev3Expenses ? 10 : 0;
    const controlValue = prev3Expenses === 0 ? 100 : Math.min(100, (1 - (expenses - prev3Expenses) / prev3Expenses) * 100);
    pillars.push({ label: "Controle", value: Math.max(0, controlValue), maxPoints: 10, earnedPoints: controlPoints });

    healthScore = Math.round(savingsPoints + trendPoints + 20 + controlPoints);
  } else {
    // Sem renda: só calcula tendência e controle
    pillars.push({ label: "Poupança", value: 0, maxPoints: 40, earnedPoints: 0 });
    pillars.push({ label: "Tendência", value: 0, maxPoints: 30, earnedPoints: 0 });
    pillars.push({ label: "Renda", value: 0, maxPoints: 20, earnedPoints: 0 });
    pillars.push({ label: "Controle", value: 0, maxPoints: 10, earnedPoints: 0 });
  }

  // --- Insights ---
  const insights: { type: "positive" | "negative" | "warning"; text: string; badgeText: string }[] = [];

  // Insight 1: Categoria com maior variação vs. histórico 6m
  const expenseTx = periodTx.filter((tx) => tx.type === "EXPENSE");
  const catSpend = new Map<string, { name: string; value: number }>();
  for (const tx of expenseTx) {
    const key = tx.categoryId;
    const ex = catSpend.get(key);
    if (ex) ex.value += toNumber(tx.amount);
    else catSpend.set(key, { name: tx.category.name, value: toNumber(tx.amount) });
  }

  const histExpense = historyTx.filter((tx) => tx.type === "EXPENSE");
  const histCatSpend = new Map<string, number>();
  for (const tx of histExpense) {
    histCatSpend.set(tx.categoryId, (histCatSpend.get(tx.categoryId) ?? 0) + toNumber(tx.amount));
  }

  let maxVariation = 0;
  let maxVarCat = "";
  let maxVarPct = 0;
  for (const [id, cat] of catSpend.entries()) {
    const histVal = (histCatSpend.get(id) ?? 0) / 6; // média mensal
    if (histVal > 0) {
      const pct = ((cat.value - histVal) / histVal) * 100;
      if (Math.abs(pct) > Math.abs(maxVariation)) {
        maxVariation = pct;
        maxVarCat = cat.name;
        maxVarPct = pct;
      }
    }
  }

  if (maxVarCat) {
    const type: "positive" | "negative" | "warning" = maxVarPct < -10 ? "positive" : maxVarPct > 20 ? "negative" : "warning";
    const sign = maxVarPct >= 0 ? "+" : "";
    insights.push({
      type,
      text: `${maxVarCat}: ${maxVarPct > 0 ? "aumento" : "redução"} de gastos vs. média histórica`,
      badgeText: `${sign}${maxVarPct.toFixed(0)}%`,
    });
  }

  // Insight 2: Top merchant por valor no período
  const merchantMap = new Map<string, number>();
  for (const tx of expenseTx) {
    const key = tx.description.trim().toLowerCase().slice(0, 40);
    merchantMap.set(key, (merchantMap.get(key) ?? 0) + toNumber(tx.amount));
  }
  let topMerchant = "";
  let topMerchantVal = 0;
  for (const [desc, val] of merchantMap.entries()) {
    if (val > topMerchantVal) {
      topMerchantVal = val;
      topMerchant = desc;
    }
  }
  if (topMerchant && topMerchantVal > 0) {
    const pctOfTotal = expenses > 0 ? (topMerchantVal / expenses) * 100 : 0;
    insights.push({
      type: pctOfTotal > 30 ? "warning" : "negative",
      text: `"${topMerchant}" foi seu maior gasto do período`,
      badgeText: `${pctOfTotal.toFixed(0)}% do total`,
    });
  }

  // Insight 3: Taxa de poupança vs. meta 20%
  if (income > 0) {
    const sr = ((income - expenses) / income) * 100;
    if (sr >= 20) {
      insights.push({
        type: "positive",
        text: `Taxa de poupança acima da meta de 20% — ótimo trabalho!`,
        badgeText: `${sr.toFixed(1)}%`,
      });
    } else if (sr < 0) {
      insights.push({
        type: "negative",
        text: `Gastos superam receitas no período — déficit orçamentário`,
        badgeText: `${sr.toFixed(1)}%`,
      });
    } else {
      insights.push({
        type: "warning",
        text: `Taxa de poupança abaixo da meta de 20%`,
        badgeText: `${sr.toFixed(1)}%`,
      });
    }
  }

  // --- Spending Velocity (sempre mês atual, independente do filtro) ---
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [currentMonthTx, prev3Tx] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, type: "EXPENSE", date: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        type: "EXPENSE",
        date: {
          gte: new Date(now.getFullYear(), now.getMonth() - 3, 1),
          lt: monthStart,
        },
      },
    }),
  ]);

  const spent = currentMonthTx.reduce((acc, tx) => acc + toNumber(tx.amount), 0);
  const prev3Sums = getLastNMonths(prev3Tx, monthStart, 3);
  const budget = prev3Sums.length > 0 ? prev3Sums.reduce((a, b) => a + b, 0) / prev3Sums.length : 0;

  const dayOfMonth = now.getDate();
  const daysInMonth = monthEnd.getDate();
  const projectedEnd = dayOfMonth > 0 ? (spent / dayOfMonth) * daysInMonth : 0;
  const projectedOverrun = budget > 0 ? ((projectedEnd - budget) / budget) * 100 : 0;

  const velocity = budget > 0
    ? { budget, spent, dayOfMonth, daysInMonth, projectedEnd, projectedOverrun }
    : null;

  return NextResponse.json({ healthScore, pillars, insights, velocity });
}

/** Retorna array com despesa total de cada um dos N meses completos anteriores a `before` */
function getLastNMonths(
  transactions: { type: string; amount: unknown; date: Date }[],
  before: Date,
  n: number
): number[] {
  const results: number[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(before.getFullYear(), before.getMonth() - i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthExpenses = transactions
      .filter((tx) => tx.type === "EXPENSE" && tx.date >= d && tx.date <= mEnd)
      .reduce((acc, tx) => acc + toNumber(tx.amount), 0);
    results.push(monthExpenses);
  }
  return results;
}

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

  // 12 meses terminando em filterEnd (para monthlyBars — contexto histórico)
  const historyStart = new Date(filterEnd);
  historyStart.setMonth(historyStart.getMonth() - 11);
  historyStart.setDate(1);
  historyStart.setHours(0, 0, 0, 0);

  const [allTx, periodTx] = await Promise.all([
    // Últimos 12 meses (para o gráfico de barras)
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: historyStart, lte: filterEnd },
      },
    }),
    // Período filtrado com categoria (para Sankey)
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: filterStart, lte: filterEnd },
      },
      include: { category: true },
    }),
  ]);

  // --- monthlyBars: últimos 12 meses ---
  const monthlyBars = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(filterEnd.getFullYear(), filterEnd.getMonth() - (11 - i), 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthTx = allTx.filter((tx) => tx.date >= d && tx.date <= mEnd);

    const income = monthTx
      .filter((tx) => tx.type === "INCOME")
      .reduce((acc, tx) => acc + toNumber(tx.amount), 0);
    const expenses = monthTx
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((acc, tx) => acc + toNumber(tx.amount), 0);

    return {
      month: d.toLocaleString("pt-BR", { month: "short", year: "2-digit" }),
      income,
      expenses,
      net: income - expenses,
    };
  });

  // --- sankeyData: para o período filtrado ---
  const periodIncome = periodTx.filter((tx) => tx.type === "INCOME");
  const periodExpenses = periodTx.filter((tx) => tx.type === "EXPENSE");

  const totalIncome = periodIncome.reduce((acc, tx) => acc + toNumber(tx.amount), 0);
  const totalExpenses = periodExpenses.reduce((acc, tx) => acc + toNumber(tx.amount), 0);

  // Agrupar receitas por categoria
  const incomeByCategory = new Map<string, { id: string; name: string; value: number }>();
  for (const tx of periodIncome) {
    const key = tx.categoryId;
    const existing = incomeByCategory.get(key);
    if (existing) {
      existing.value += toNumber(tx.amount);
    } else {
      incomeByCategory.set(key, {
        id: `income_${key}`,
        name: tx.category.name,
        value: toNumber(tx.amount),
      });
    }
  }

  // Agrupar despesas por categoria (agrupar < 3% em "Outros")
  const expenseByCategory = new Map<string, { id: string; name: string; value: number }>();
  for (const tx of periodExpenses) {
    const key = tx.categoryId;
    const existing = expenseByCategory.get(key);
    if (existing) {
      existing.value += toNumber(tx.amount);
    } else {
      expenseByCategory.set(key, {
        id: `expense_${key}`,
        name: tx.category.name,
        value: toNumber(tx.amount),
      });
    }
  }

  const threshold = totalExpenses * 0.03;
  const mainExpenses: { id: string; name: string; value: number }[] = [];
  let othersValue = 0;

  for (const cat of expenseByCategory.values()) {
    if (cat.value < threshold) {
      othersValue += cat.value;
    } else {
      mainExpenses.push(cat);
    }
  }
  if (othersValue > 0) {
    mainExpenses.push({ id: "expense_others", name: "Outros", value: othersValue });
  }

  // Nó intermediário "Disponível"
  const available = totalIncome - totalExpenses;

  const sankeyNodes = [
    ...Array.from(incomeByCategory.values()).map((c) => ({ id: c.id, label: c.name })),
    { id: "disponivel", label: "Disponível" },
    ...mainExpenses.map((c) => ({ id: c.id, label: c.name })),
  ];

  const sankeyLinks = [
    // Receitas → Disponível
    ...Array.from(incomeByCategory.values()).map((c) => ({
      from: c.id,
      to: "disponivel",
      value: c.value,
    })),
    // Disponível → Despesas por categoria
    ...mainExpenses.map((c) => ({
      from: "disponivel",
      to: c.id,
      value: c.value,
    })),
    // Disponível → Poupança (se positivo)
    ...(available > 0
      ? [{ from: "disponivel", to: "poupanca", value: available }]
      : []),
  ];

  if (available > 0) {
    sankeyNodes.push({ id: "poupanca", label: "Poupança" });
  }

  return NextResponse.json({ monthlyBars, sankeyNodes, sankeyLinks });
}

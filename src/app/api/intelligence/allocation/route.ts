import { toNumber } from "@/lib/utils";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface AllocationSuggestionItem {
  type: string;
  label: string;
  pct: number;
  amount: number;
}

export interface AllocationResponse {
  availableMonthly: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  suggestions: AllocationSuggestionItem[];
}

const TYPE_LABELS: Record<string, string> = {
  FIXED_INCOME: "Renda Fixa",
  FII: "Fundos Imobiliários",
  STOCK: "Ações BR",
  ETF: "ETF",
  BDR: "BDR",
  CRYPTO: "Criptomoedas",
  STOCK_INT: "Ações Internacionais",
  OTHER: "Outros",
};

const DEFAULT_PROFILE: Record<string, number> = {
  FIXED_INCOME: 40,
  FII: 30,
  STOCK: 20,
  ETF: 10,
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Calcular income/expenses do mês atual
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const txs = await prisma.transaction.findMany({
    where: { userId, date: { gte: monthStart, lte: monthEnd } },
  });

  const monthlyIncome = txs
    .filter((t) => t.type === "INCOME")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);

  const monthlyExpenses = txs
    .filter((t) => t.type === "EXPENSE")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);

  const availableMonthly = Math.max(0, monthlyIncome - monthlyExpenses);

  // Histórico de aportes nos últimos 12 meses por tipo de ativo
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const purchaseEntries = await prisma.investmentEntry.findMany({
    where: { userId, type: "PURCHASE", date: { gte: since } },
    include: { asset: true },
  });

  // Agrupar por tipo de ativo
  const typeAmounts: Record<string, number> = {};
  for (const entry of purchaseEntries) {
    const type = entry.asset.type;
    typeAmounts[type] = (typeAmounts[type] ?? 0) + toNumber(entry.amount);
  }

  const totalAmount = Object.values(typeAmounts).reduce((a, b) => a + b, 0);

  let distribution: Record<string, number>;
  if (totalAmount === 0) {
    distribution = DEFAULT_PROFILE;
  } else {
    distribution = {};
    for (const [type, amount] of Object.entries(typeAmounts)) {
      distribution[type] = Math.round((amount / totalAmount) * 100);
    }
  }

  const suggestions: AllocationSuggestionItem[] = Object.entries(distribution)
    .sort(([, a], [, b]) => b - a)
    .map(([type, pct]) => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      pct,
      amount: availableMonthly * (pct / 100),
    }));

  return NextResponse.json({
    availableMonthly,
    monthlyIncome,
    monthlyExpenses,
    suggestions,
  } satisfies AllocationResponse);
}

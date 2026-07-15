import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanDescription } from "@/lib/import/cleanDescription";
import { toNumber } from "@/lib/utils";

type Frequency = "weekly" | "monthly" | "yearly";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "EXPENSE" },
    orderBy: { date: "asc" },
  });

  // Agrupar por description normalizada
  const groups = new Map<
    string,
    { description: string; amount: number; dates: Date[] }
  >();

  for (const tx of transactions) {
    const normalized = cleanDescription(tx.description).toLowerCase();
    if (!normalized) continue;

    const existing = groups.get(normalized);
    if (existing) {
      existing.dates.push(tx.date);
      // Usa o valor mais recente
      existing.amount = toNumber(tx.amount);
    } else {
      groups.set(normalized, {
        description: cleanDescription(tx.description),
        amount: toNumber(tx.amount),
        dates: [tx.date],
      });
    }
  }

  const recurring: {
    description: string;
    amount: number;
    frequency: Frequency;
    lastDate: string;
    isNew: boolean;
    monthlyEquivalent: number;
  }[] = [];

  for (const [, group] of groups) {
    if (group.dates.length < 3) continue;

    const dates = group.dates.sort((a, b) => a.getTime() - b.getTime());

    // Calcular intervalo médio em dias
    const diffs: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diffMs = dates[i].getTime() - dates[i - 1].getTime();
      diffs.push(diffMs / (1000 * 60 * 60 * 24));
    }
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;

    let frequency: Frequency | null = null;
    let monthlyEquivalent = 0;

    if (avgDiff >= 5 && avgDiff <= 9) {
      frequency = "weekly";
      monthlyEquivalent = group.amount * 4.33;
    } else if (avgDiff >= 25 && avgDiff <= 35) {
      frequency = "monthly";
      monthlyEquivalent = group.amount;
    } else if (avgDiff >= 350 && avgDiff <= 380) {
      frequency = "yearly";
      monthlyEquivalent = group.amount / 12;
    }

    if (!frequency) continue;

    const firstDate = dates[0];
    const now = new Date();
    const daysSinceFirst = (now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
    const isNew = daysSinceFirst <= 90;

    recurring.push({
      description: group.description,
      amount: group.amount,
      frequency,
      lastDate: dates[dates.length - 1].toISOString(),
      isNew,
      monthlyEquivalent,
    });
  }

  // Ordenar por monthlyEquivalent DESC, limitar a 20
  recurring.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  const result = recurring.slice(0, 20);

  return NextResponse.json(result);
}

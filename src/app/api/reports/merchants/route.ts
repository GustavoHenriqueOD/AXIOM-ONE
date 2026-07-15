import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanDescription } from "@/lib/import/cleanDescription";
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

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      type: "EXPENSE",
      date: { gte: filterStart, lte: filterEnd },
    },
    include: { category: true },
  });

  // Agrupar por description normalizada
  const merchantMap = new Map<
    string,
    {
      name: string;
      total: number;
      count: number;
      categoryName: string;
      categoryColor: string;
      lastDate: Date;
    }
  >();

  for (const tx of transactions) {
    const normalized = cleanDescription(tx.description).toLowerCase();
    const display = cleanDescription(tx.description);
    const amount = toNumber(tx.amount);

    const existing = merchantMap.get(normalized);
    if (existing) {
      existing.total += amount;
      existing.count++;
      if (tx.date > existing.lastDate) existing.lastDate = tx.date;
    } else {
      merchantMap.set(normalized, {
        name: display,
        total: amount,
        count: 1,
        categoryName: tx.category.name,
        categoryColor: tx.category.color,
        lastDate: tx.date,
      });
    }
  }

  const totalExpenses = Array.from(merchantMap.values()).reduce(
    (acc, m) => acc + m.total,
    0
  );

  const merchants = Array.from(merchantMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((m) => ({
      name: m.name,
      total: m.total,
      count: m.count,
      pctOfTotal: totalExpenses > 0 ? (m.total / totalExpenses) * 100 : 0,
      categoryName: m.categoryName,
      categoryColor: m.categoryColor,
      lastDate: m.lastDate.toISOString(),
    }));

  const periodLabel = `${startParam} → ${endParam}`;

  return NextResponse.json({ merchants, periodLabel });
}

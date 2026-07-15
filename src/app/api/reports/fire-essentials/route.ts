import { toNumber } from "@/lib/utils";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import type { FireEssentialsResponse } from "@/types/fire";
export type { FireEssentialsResponse };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // 1. Fetch essential categories
  const essentialCategories = await prisma.category.findMany({
    where: { userId, isEssential: true },
  });

  // 2. Fetch all LIABILITY items with a linked category
  const liabilities = await prisma.wealthItem.findMany({
    where: { userId, itemType: "LIABILITY", linkedCategoryId: { not: null } },
    include: { linkedCategory: true },
  });

  // 3. Gather all relevant category IDs (essentials + liability-linked)
  const essentialIds = new Set(essentialCategories.map((c) => c.id));
  const liabilityCategoryIds = liabilities
    .map((l) => l.linkedCategoryId!)
    .filter((id) => !essentialIds.has(id)); // only non-essentials need separate fetch

  const allCategoryIds = [
    ...essentialCategories.map((c) => c.id),
    ...liabilityCategoryIds,
  ];

  // 4. Fetch transactions in a single query grouped by categoryId
  const txRows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      userId,
      type: "EXPENSE",
      date: { gte: threeMonthsAgo },
      categoryId: { in: allCategoryIds },
    },
    _sum: { amount: true },
  });

  const sumByCategory = new Map<string, number>();
  for (const row of txRows) {
    sumByCategory.set(row.categoryId, toNumber(row._sum.amount ?? 0));
  }

  // 5. Build essential categories list
  const categories = essentialCategories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    color: cat.color,
    monthlyAvg: (sumByCategory.get(cat.id) ?? 0) / 3,
  }));

  const totalEssentialMonthly = categories.reduce((s, c) => s + c.monthlyAvg, 0);

  // 6. Build liability costs list
  const liabilityCosts = liabilities
    .filter((l) => l.linkedCategory !== null)
    .map((l) => ({
      wealthItemId: l.id,
      wealthItemName: l.name,
      categoryId: l.linkedCategoryId!,
      categoryName: l.linkedCategory!.name,
      categoryColor: l.linkedCategory!.color,
      monthlyAvg: (sumByCategory.get(l.linkedCategoryId!) ?? 0) / 3,
    }));

  return NextResponse.json({
    categories,
    totalEssentialMonthly,
    liabilityCosts,
  } satisfies FireEssentialsResponse);
}


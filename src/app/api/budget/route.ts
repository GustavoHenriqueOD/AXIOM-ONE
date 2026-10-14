import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const userId = session.user.id;

  const budgets = await prisma.budget.findMany({
    where: { userId },
    include: { category: true },
    orderBy: { createdAt: "asc" },
  });

  const result = await Promise.all(
    budgets.map(async (b) => {
      const agg = await prisma.transaction.aggregate({
        where: {
          userId,
          categoryId: b.categoryId,
          type: "EXPENSE",
          date: { gte: startOfMonth },
        },
        _sum: { amount: true },
      });
      const currentSpend = toNumber(agg._sum.amount ?? 0);
      const limit = toNumber(b.monthlyLimit);
      const percentUsed = limit > 0 ? (currentSpend / limit) * 100 : 0;

      return {
        id: b.id,
        categoryId: b.categoryId,
        categoryName: b.category.name,
        categoryColor: b.category.color,
        monthlyLimit: limit,
        currentSpend,
        percentUsed: Math.round(percentUsed * 10) / 10,
      };
    })
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { categoryId, monthlyLimit } = body;

  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId é obrigatório" }, { status: 400 });
  }
  if (typeof monthlyLimit !== "number" || monthlyLimit <= 0) {
    return NextResponse.json({ error: "monthlyLimit deve ser maior que zero" }, { status: 400 });
  }

  // Ownership check
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== session.user.id) {
    return NextResponse.json({ error: "Categoria não encontrada" }, { status: 403 });
  }

  const budget = await prisma.budget.upsert({
    where: { userId_categoryId: { userId: session.user.id, categoryId } },
    create: { userId: session.user.id, categoryId, monthlyLimit },
    update: { monthlyLimit },
  });

  return NextResponse.json({ ...budget, monthlyLimit: toNumber(budget.monthlyLimit) }, { status: 200 });
}

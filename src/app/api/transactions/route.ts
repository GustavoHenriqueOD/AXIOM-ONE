import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Helper: alerta por orçamento de categoria (dedup por mês)
async function checkCategoryBudgetAlert(
  userId: string,
  categoryId: string,
  categoryName: string
) {
  const budget = await prisma.budget.findUnique({
    where: { userId_categoryId: { userId, categoryId } },
  });
  if (!budget) return;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const agg = await prisma.transaction.aggregate({
    where: { userId, categoryId, type: "EXPENSE", date: { gte: startOfMonth } },
    _sum: { amount: true },
  });

  const spent = toNumber(agg._sum.amount ?? 0);
  const limit = toNumber(budget.monthlyLimit);
  const pct = limit > 0 ? (spent / limit) * 100 : 0;

  if (pct < 80) return;

  // Dedup: 1 alerta por categoria por mês (busca por categoryId — robusto a renomes)
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: "BUDGET_ALERT",
      categoryId,
      createdAt: { gte: startOfMonth },
    },
  });
  if (existing) return;

  const label = pct >= 100 ? "ultrapassou" : `atingiu ${Math.round(pct)}% de`;
  await prisma.notification.create({
    data: {
      userId,
      type: "BUDGET_ALERT",
      title: `Orçamento: ${categoryName}`,
      message: `Você ${label} o limite mensal de "${categoryName}".`,
      categoryId,
    },
  });
}

async function generateTransactionNotifications(
  userId: string,
  tx: { description: string; amount: number; type: string; categoryName: string; categoryId: string }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifTransactions: true, notifBudgetAlerts: true },
  });
  if (!user) return;

  const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(tx.amount);
  const typeLabel = tx.type === "INCOME" ? "Receita" : "Despesa";

  if (user.notifTransactions) {
    await prisma.notification.create({
      data: {
        userId,
        type: "TRANSACTION",
        title: `${typeLabel} registrada`,
        message: `${tx.description} · ${tx.categoryName} · ${formatted}`,
      },
    });
  }

  if (user.notifBudgetAlerts && tx.type === "EXPENSE") {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthlyExpense, monthlyIncome] = await Promise.all([
      prisma.transaction.aggregate({
        where: { userId, type: "EXPENSE", date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { userId, type: "INCOME", date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const totalExpense = toNumber(monthlyExpense._sum.amount ?? 0);
    const totalIncome = toNumber(monthlyIncome._sum.amount ?? 0);

    // Alert when expenses exceed 80% of income (and income > 0)
    if (totalIncome > 0 && totalExpense >= totalIncome * 0.8) {
      // Deduplicate: only one budget alert per day
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const existing = await prisma.notification.findFirst({
        where: { userId, type: "BUDGET_ALERT", createdAt: { gte: todayStart } },
      });
      if (!existing) {
        const pct = Math.round((totalExpense / totalIncome) * 100);
        await prisma.notification.create({
          data: {
            userId,
            type: "BUDGET_ALERT",
            title: "Alerta de Gastos",
            message: `Seus gastos este mês já representam ${pct}% das suas receitas.`,
          },
        });
      }
    }

    // Alerta específico por orçamento de categoria
    if (user.notifBudgetAlerts && tx.categoryId) {
      await checkCategoryBudgetAlert(userId, tx.categoryId, tx.categoryName);
    }
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId: session.user.id },
    orderBy: { date: "desc" },
    include: { category: true },
  });

  const serialized = transactions.map((tx) => ({
    ...tx,
    amount: toNumber(tx.amount),
    date: tx.date.toISOString(),
  }));

  return NextResponse.json(serialized);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { description, amount, type, categoryId, date } = body;

  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json({ error: "Descrição é obrigatória" }, { status: 400 });
  }

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
  }

  if (!type || !["INCOME", "EXPENSE"].includes(type)) {
    return NextResponse.json({ error: "Tipo inválido (INCOME ou EXPENSE)" }, { status: 400 });
  }

  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ error: "Categoria é obrigatória" }, { status: 400 });
  }

  if (!date || isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== session.user.id) {
    return NextResponse.json({ error: "Categoria não encontrada" }, { status: 403 });
  }

  const transaction = await prisma.transaction.create({
    data: {
      description: description.trim(),
      amount,
      type,
      categoryId,
      date: new Date(date),
      userId: session.user.id,
    },
    include: { category: true },
  });

  // Generate notifications (fire-and-forget — don't block response)
  generateTransactionNotifications(session.user.id, {
    description: description.trim(),
    amount,
    type,
    categoryName: transaction.category.name,
    categoryId: transaction.categoryId,
  }).catch(() => {});

  const serialized = {
    ...transaction,
    amount: toNumber(transaction.amount),
    date: transaction.date.toISOString(),
  };

  return NextResponse.json(serialized, { status: 201 });
}

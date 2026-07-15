import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction || transaction.userId !== session.user.id) {
    return NextResponse.json({ error: "Transação não encontrada" }, { status: 403 });
  }

  const body = await req.json();
  const { description, amount, type, categoryId, date } = body;

  if (amount !== undefined && (typeof amount !== "number" || amount <= 0)) {
    return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
  }

  if (type !== undefined && !["INCOME", "EXPENSE"].includes(type)) {
    return NextResponse.json({ error: "Tipo inválido (INCOME ou EXPENSE)" }, { status: 400 });
  }

  if (categoryId !== undefined) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.userId !== session.user.id) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 403 });
    }
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...(description !== undefined && { description: description.trim() }),
      ...(amount !== undefined && { amount }),
      ...(type !== undefined && { type }),
      ...(categoryId !== undefined && { categoryId }),
      ...(date !== undefined && { date: new Date(date) }),
    },
    include: { category: true },
  });

  const serialized = {
    ...updated,
    amount: toNumber(updated.amount),
    date: updated.date.toISOString(),
  };

  return NextResponse.json(serialized);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction || transaction.userId !== session.user.id) {
    return NextResponse.json({ error: "Transação não encontrada" }, { status: 403 });
  }

  await prisma.transaction.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

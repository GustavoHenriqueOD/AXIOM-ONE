import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EntryType } from "@/generated/prisma/client";

const VALID_ENTRY_TYPES = Object.values(EntryType);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.investmentEntry.findUnique({ where: { id } });
  if (!entry || entry.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  const body = await req.json();
  const { type, date, quantity, price, notes } = body;

  if (type !== undefined && !VALID_ENTRY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  const newQty = quantity !== undefined ? Number(quantity) : toNumber(entry.quantity);
  const newType = type ?? entry.type;
  const newPrice = newType === "SPLIT" ? 0 : (price !== undefined ? Number(price) : toNumber(entry.price));
  const newAmount = newQty * newPrice;

  const updated = await prisma.investmentEntry.update({
    where: { id },
    data: {
      ...(type !== undefined && { type }),
      ...(date !== undefined && { date: new Date(date) }),
      quantity: newQty,
      price: newPrice,
      amount: newAmount,
      ...(notes !== undefined && { notes: notes || null }),
    },
    include: { asset: { select: { id: true, name: true, ticker: true, type: true, currency: true } } },
  });

  return NextResponse.json({
    ...updated,
    quantity: toNumber(updated.quantity),
    price: toNumber(updated.price),
    amount: toNumber(updated.amount),
    date: updated.date.toISOString(),
    createdAt: updated.createdAt.toISOString(),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.investmentEntry.findUnique({ where: { id } });
  if (!entry || entry.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  await prisma.investmentEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

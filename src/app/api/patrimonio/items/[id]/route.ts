import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcCurrentValue } from "@/lib/wealthCalc";
import type { WealthItemSerialized } from "../route";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, value, category, appreciationRate, rateFrequency, loanBank, loanInstallments, loanStartDate, loanDueDay, notes, linkedCategoryId } = body;

  const item = await prisma.wealthItem.findUnique({ where: { id } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  if (value !== undefined && (typeof value !== "number" || value <= 0)) {
    return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
  }
  if (appreciationRate !== undefined && appreciationRate !== null &&
      (typeof appreciationRate !== "number" || appreciationRate < -100 || appreciationRate > 100)) {
    return NextResponse.json({ error: "Taxa inválida. Use valores entre -100 e 100." }, { status: 400 });
  }
  if (linkedCategoryId) {
    const cat = await prisma.category.findFirst({ where: { id: linkedCategoryId, userId: session.user.id } });
    if (!cat) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 400 });
  }

  const updated = await prisma.wealthItem.update({
    include: { linkedCategory: true },
    where: { id },
    data: {
      ...(name && { name: name.trim() }),
      ...(value !== undefined && {
        value,
        // Quando o valor é atualizado manualmente, reinicia o ponto de partida
        // para que a valorização continue a partir do novo valor informado
        appreciationStart: new Date(),
      }),
      ...(category && { category: category.trim() }),
      // appreciationRate pode ser null (para remover a taxa)
      ...(appreciationRate !== undefined && { appreciationRate: appreciationRate }),
      ...(rateFrequency !== undefined && { rateFrequency }),
      ...(loanBank !== undefined && { loanBank: loanBank ?? null }),
      ...(loanInstallments !== undefined && { loanInstallments: loanInstallments ?? null }),
      ...(loanStartDate !== undefined && { loanStartDate: loanStartDate ? new Date(loanStartDate) : null }),
      ...(loanDueDay !== undefined && { loanDueDay: loanDueDay ?? null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(linkedCategoryId !== undefined && { linkedCategoryId: linkedCategoryId ?? null }),
    },
  });

  const baseValue = toNumber(updated.value);
  const rate = updated.appreciationRate != null ? toNumber(updated.appreciationRate) : null;
  const start = updated.appreciationStart ?? updated.createdAt;
  const frequency = (updated.rateFrequency as "MONTHLY" | "ANNUAL") ?? "ANNUAL";

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    value: calcCurrentValue(baseValue, rate, frequency, start),
    baseValue,
    itemType: updated.itemType as "ASSET" | "LIABILITY",
    category: updated.category,
    appreciationRate: rate,
    appreciationStart: start.toISOString(),
    rateFrequency: frequency,
    loanBank: updated.loanBank,
    loanInstallments: updated.loanInstallments,
    loanStartDate: updated.loanStartDate?.toISOString() ?? null,
    loanDueDay: updated.loanDueDay ?? null,
    linkedCategoryId: updated.linkedCategoryId ?? null,
    linkedCategoryName: updated.linkedCategory?.name ?? null,
    notes: updated.notes,
    createdAt: updated.createdAt.toISOString(),
  } satisfies WealthItemSerialized);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const item = await prisma.wealthItem.findUnique({ where: { id } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  await prisma.wealthItem.delete({ where: { id } });
  return NextResponse.json({}, { status: 204 });
}

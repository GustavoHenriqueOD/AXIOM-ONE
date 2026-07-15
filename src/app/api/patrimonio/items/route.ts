import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcCurrentValue } from "@/lib/wealthCalc";

import type { WealthItemSerialized, WealthItemsResponse } from "@/types/fire";
export type { WealthItemSerialized, WealthItemsResponse };

function serialize(item: {
  id: string;
  name: string;
  value: unknown;
  itemType: string;
  category: string;
  appreciationRate: unknown;
  appreciationStart: Date | null;
  rateFrequency: string;
  loanBank: string | null;
  loanInstallments: number | null;
  loanStartDate: Date | null;
  loanDueDay: number | null;
  linkedCategoryId: string | null;
  linkedCategory?: { name: string } | null;
  notes: string | null;
  createdAt: Date;
}): WealthItemSerialized {
  const baseValue = toNumber(item.value);
  const rate = item.appreciationRate != null ? toNumber(item.appreciationRate) : null;
  const start = item.appreciationStart ?? item.createdAt;
  const frequency = (item.rateFrequency as "MONTHLY" | "ANNUAL") ?? "ANNUAL";
  const currentValue = calcCurrentValue(baseValue, rate, frequency, start);

  return {
    id: item.id,
    name: item.name,
    value: currentValue,
    baseValue,
    itemType: item.itemType as "ASSET" | "LIABILITY",
    category: item.category,
    appreciationRate: rate,
    appreciationStart: start.toISOString(),
    rateFrequency: frequency,
    loanBank: item.loanBank,
    loanInstallments: item.loanInstallments,
    loanStartDate: item.loanStartDate?.toISOString() ?? null,
    loanDueDay: item.loanDueDay ?? null,
    linkedCategoryId: item.linkedCategoryId ?? null,
    linkedCategoryName: item.linkedCategory?.name ?? null,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.wealthItem.findMany({
    where: { userId: session.user.id },
    orderBy: [{ itemType: "asc" }, { createdAt: "desc" }],
    include: { linkedCategory: true },
  });

  const items = rows.map(serialize);

  const totalAssets = items
    .filter((i) => i.itemType === "ASSET")
    .reduce((acc, i) => acc + i.value, 0);

  const totalLiabilities = items
    .filter((i) => i.itemType === "LIABILITY")
    .reduce((acc, i) => acc + i.value, 0);

  return NextResponse.json({
    items,
    totalAssets,
    totalLiabilities,
    net: totalAssets - totalLiabilities,
  } satisfies WealthItemsResponse);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, value, itemType, category, appreciationRate, rateFrequency, loanBank, loanInstallments, loanStartDate, loanDueDay, notes, linkedCategoryId } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }
  if (!value || typeof value !== "number" || value <= 0) {
    return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
  }
  if (itemType !== "ASSET" && itemType !== "LIABILITY") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ error: "Categoria é obrigatória" }, { status: 400 });
  }
  if (appreciationRate !== undefined && appreciationRate !== null &&
      (typeof appreciationRate !== "number" || appreciationRate < -100 || appreciationRate > 100)) {
    return NextResponse.json({ error: "Taxa inválida. Use valores entre -100 e 100." }, { status: 400 });
  }
  if (linkedCategoryId) {
    const cat = await prisma.category.findFirst({ where: { id: linkedCategoryId, userId: session.user.id } });
    if (!cat) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 400 });
  }

  const item = await prisma.wealthItem.create({
    include: { linkedCategory: true },
    data: {
      userId: session.user.id,
      name: name.trim(),
      value,
      itemType,
      category: category.trim(),
      appreciationRate: appreciationRate ?? null,
      appreciationStart: new Date(),
      rateFrequency: rateFrequency ?? "ANNUAL",
      loanBank: loanBank ?? null,
      loanInstallments: loanInstallments ?? null,
      loanStartDate: loanStartDate ? new Date(loanStartDate) : null,
      loanDueDay: loanDueDay ?? null,
      linkedCategoryId: linkedCategoryId ?? null,
      notes: notes?.trim() || null,
    },
  });

  return NextResponse.json(serialize(item), { status: 201 });
}

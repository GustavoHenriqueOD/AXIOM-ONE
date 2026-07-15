import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AssetType } from "@/generated/prisma/client";

const VALID_ASSET_TYPES = Object.values(AssetType);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset || asset.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  const body = await req.json();
  const { name, ticker, type, currency, currentPrice, indexer, rate } = body;

  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
  }
  if (type !== undefined && !VALID_ASSET_TYPES.includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(ticker !== undefined && { ticker: ticker ? ticker.trim().toUpperCase() : null }),
      ...(type !== undefined && { type }),
      ...(currency !== undefined && { currency }),
      ...(currentPrice !== undefined && { currentPrice: currentPrice != null ? currentPrice : null }),
      ...(indexer !== undefined && { indexer }),
      ...(rate !== undefined && { rate: rate != null ? rate : null }),
    },
  });

  return NextResponse.json({
    ...updated,
    currentPrice: updated.currentPrice ? toNumber(updated.currentPrice) : null,
    rate: updated.rate ? toNumber(updated.rate) : null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });

  if (!asset || asset.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }
  if (asset._count.entries > 0) {
    return NextResponse.json({ error: "Não é possível excluir um ativo com lançamentos" }, { status: 409 });
  }

  await prisma.asset.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

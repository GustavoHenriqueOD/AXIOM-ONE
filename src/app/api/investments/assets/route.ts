import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AssetType } from "@/generated/prisma/client";

const VALID_ASSET_TYPES = Object.values(AssetType);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assets = await prisma.asset.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const serialized = assets.map((a) => ({
    ...a,
    currentPrice: a.currentPrice ? toNumber(a.currentPrice) : null,
    rate: a.rate ? toNumber(a.rate) : null,
  }));

  return NextResponse.json(serialized);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, type, ticker, currency = "BRL", currentPrice, indexer, rate } = body;

  const VALID_INDEXERS = ["CDI", "SELIC", "PREFIXADO", "POUPANCA"];

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }
  if (!type || !VALID_ASSET_TYPES.includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  if (currentPrice !== undefined && currentPrice !== null && isNaN(Number(currentPrice))) {
    return NextResponse.json({ error: "Preço inválido" }, { status: 400 });
  }
  if (indexer !== undefined && indexer !== null && !VALID_INDEXERS.includes(indexer)) {
    return NextResponse.json({ error: "Indexador inválido" }, { status: 400 });
  }
  if (rate !== undefined && rate !== null && (isNaN(Number(rate)) || Number(rate) < 0)) {
    return NextResponse.json({ error: "Taxa inválida" }, { status: 400 });
  }

  // Check for duplicate ticker
  if (ticker && typeof ticker === "string" && ticker.trim().length > 0) {
    const existing = await prisma.asset.findUnique({
      where: { userId_ticker: { userId: session.user.id, ticker: ticker.trim().toUpperCase() } },
    });
    if (existing) {
      return NextResponse.json({ error: "Ticker já cadastrado" }, { status: 409 });
    }
  }

  const asset = await prisma.asset.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      type,
      ticker: ticker ? ticker.trim().toUpperCase() : null,
      currency,
      currentPrice: currentPrice != null ? currentPrice : null,
      indexer: indexer ?? null,
      rate: rate != null ? rate : null,
    },
  });

  return NextResponse.json({
    ...asset,
    currentPrice: asset.currentPrice ? toNumber(asset.currentPrice) : null,
    rate: asset.rate ? toNumber(asset.rate) : null,
  });
}

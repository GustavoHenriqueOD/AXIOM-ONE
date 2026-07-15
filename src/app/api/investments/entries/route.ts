import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AssetType, EntryType } from "@/generated/prisma/client";

const VALID_ENTRY_TYPES = Object.values(EntryType);
const VALID_ASSET_TYPES = Object.values(AssetType);

function serializeEntry(entry: {
  id: string;
  assetId: string;
  userId: string;
  type: EntryType;
  date: Date;
  quantity: { toString(): string };
  price: { toString(): string };
  amount: { toString(): string };
  notes: string | null;
  createdAt: Date;
  asset?: { id: string; name: string; ticker: string | null; type: string; currency: string };
}) {
  return {
    ...entry,
    quantity: toNumber(entry.quantity),
    price: toNumber(entry.price),
    amount: toNumber(entry.amount),
    date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get("assetId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const entries = await prisma.investmentEntry.findMany({
    where: {
      userId: session.user.id,
      ...(assetId && { assetId }),
      ...(start || end
        ? {
            date: {
              ...(start && { gte: new Date(start) }),
              ...(end && { lte: new Date(end) }),
            },
          }
        : {}),
    },
    include: { asset: { select: { id: true, name: true, ticker: true, type: true, currency: true } } },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(entries.map(serializeEntry));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { assetId, newAsset, type, date, quantity, price, notes } = body;

  // Validate asset: either existing assetId OR newAsset with name+type
  if (!assetId && !newAsset?.name) {
    return NextResponse.json({ error: "Ativo obrigatório" }, { status: 400 });
  }
  if (!assetId && newAsset && (!newAsset.type || !VALID_ASSET_TYPES.includes(newAsset.type))) {
    return NextResponse.json({ error: "Classe do ativo obrigatória" }, { status: 400 });
  }
  if (!type || !VALID_ENTRY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  if (!date) return NextResponse.json({ error: "Data obrigatória" }, { status: 400 });
  if (!quantity || Number(quantity) <= 0) {
    return NextResponse.json({ error: "Quantidade deve ser maior que zero" }, { status: 400 });
  }
  if (type !== "SPLIT" && (!price || Number(price) <= 0)) {
    return NextResponse.json({ error: "Preço deve ser maior que zero" }, { status: 400 });
  }

  // Resolve assetId: existing or create inline
  let resolvedAssetId = assetId as string;

  if (!assetId && newAsset) {
    const inlineTicker = newAsset.ticker ? String(newAsset.ticker).trim().toUpperCase() : null;
    const created = await prisma.asset.create({
      data: {
        userId: session.user.id,
        name: String(newAsset.name).trim(),
        type: newAsset.type as AssetType,
        ticker: inlineTicker,
        currentPrice: price ? Number(price) : null,
        indexer: newAsset.indexer ?? null,
        rate: newAsset.rate != null ? newAsset.rate : null,
      },
    });
    resolvedAssetId = created.id;
  } else {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.userId !== session.user.id) {
      return NextResponse.json({ error: "Ativo não encontrado" }, { status: 403 });
    }
  }

  const qty = Number(quantity);
  const unitPrice = type === "SPLIT" ? 0 : Number(price);

  // Validate SALE doesn't exceed position
  if (type === "SALE") {
    const existingEntries = await prisma.investmentEntry.findMany({
      where: { assetId: resolvedAssetId, userId: session.user.id },
    });
    let currentQty = 0;
    for (const e of existingEntries) {
      if (e.type === "PURCHASE") currentQty += toNumber(e.quantity);
      else if (e.type === "SALE") currentQty -= toNumber(e.quantity);
    }
    if (qty > currentQty) {
      return NextResponse.json(
        { error: "Quantidade vendida excede posição atual" },
        { status: 400 }
      );
    }
  }

  const amount = qty * unitPrice;

  const entry = await prisma.investmentEntry.create({
    data: {
      assetId: resolvedAssetId,
      userId: session.user.id,
      type,
      date: new Date(date),
      quantity: qty,
      price: unitPrice,
      amount,
      notes: notes || null,
    },
    include: { asset: { select: { id: true, name: true, ticker: true, type: true, currency: true } } },
  });

  return NextResponse.json(serializeEntry(entry));
}

import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvestmentEntry, Asset } from "@/generated/prisma/client";

function serializeInvestmentEntry(e: InvestmentEntry & { asset: Asset }) {
  return {
    ...e,
    quantity:  toNumber(e.quantity),
    price:     toNumber(e.price),
    amount:    toNumber(e.amount),
    date:      e.date instanceof Date      ? e.date.toISOString()      : e.date,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date();
  since.setDate(since.getDate() - 30);

  // ?include=<investmentEntryId> — modo edição: inclui operação já vinculada
  const include = req.nextUrl.searchParams.get("include");

  const entries = await prisma.investmentEntry.findMany({
    where: {
      userId: session.user.id,
      OR: [
        { type: { in: ["PURCHASE", "SALE"] }, date: { gte: since }, journalEntry: null },
        ...(include ? [{ id: include }] : []),
      ],
    },
    include: { asset: true },
    orderBy: { date: "desc" },
    take: 20,
  });

  return NextResponse.json({
    count: entries.length,
    entries: entries.map(serializeInvestmentEntry),
  });
}

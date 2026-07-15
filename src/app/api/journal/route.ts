import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHealthSnapshot } from "@/lib/healthSnapshot";
import { JournalEntry, InvestmentEntry, Asset, Prisma } from "@/generated/prisma/client";

type JournalEntryWithInvestment = JournalEntry & {
  investmentEntry: (InvestmentEntry & { asset: Asset }) | null;
};

function serializeEntry(entry: JournalEntryWithInvestment) {
  return {
    ...entry,
    sustainableSurplusAtTime: entry.sustainableSurplusAtTime
      ? toNumber(entry.sustainableSurplusAtTime)
      : null,
    date:      entry.date instanceof Date      ? entry.date.toISOString()      : entry.date,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
    updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : entry.updatedAt,
    investmentEntry: entry.investmentEntry
      ? {
          ...entry.investmentEntry,
          quantity:  toNumber(entry.investmentEntry.quantity),
          price:     toNumber(entry.investmentEntry.price),
          amount:    toNumber(entry.investmentEntry.amount),
          date:      entry.investmentEntry.date instanceof Date ? entry.investmentEntry.date.toISOString() : entry.investmentEntry.date,
          createdAt: entry.investmentEntry.createdAt instanceof Date ? entry.investmentEntry.createdAt.toISOString() : entry.investmentEntry.createdAt,
          asset: entry.investmentEntry.asset,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // "2026-03"
  const type  = searchParams.get("type");
  const tag   = searchParams.get("tag");

  const where: Prisma.JournalEntryWhereInput = {
    userId: session.user.id,
  };

  if (month) {
    const [y, m] = month.split("-").map(Number);
    where.date = { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59, 999) };
  }
  if (type) where.entryType = type as JournalEntry["entryType"];
  if (tag)  where.tags = { has: tag };

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: { date: "desc" },
    take: 100,
    include: { investmentEntry: { include: { asset: true } } },
  });

  return NextResponse.json(entries.map(serializeEntry));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, content, entryType, tags, date, investmentEntryId } = body;

  if (!title?.trim()) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: "Conteúdo obrigatório" }, { status: 400 });

  // Ownership check
  if (investmentEntryId) {
    const invEntry = await prisma.investmentEntry.findUnique({ where: { id: investmentEntryId } });
    if (!invEntry || invEntry.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const snapshot = await getHealthSnapshot(session.user.id);

  const entry = await prisma.journalEntry.create({
    data: {
      userId: session.user.id,
      title: title.trim(),
      content: content.trim(),
      entryType: entryType ?? "NOTE",
      tags: Array.isArray(tags) ? tags : [],
      date: date ? new Date(date) : new Date(),
      healthScoreAtTime: snapshot.healthScore,
      sustainableSurplusAtTime: snapshot.sustainableSurplus,
      ...(investmentEntryId ? { investmentEntryId } : {}),
    },
    include: { investmentEntry: { include: { asset: true } } },
  });

  return NextResponse.json(serializeEntry(entry), { status: 201 });
}

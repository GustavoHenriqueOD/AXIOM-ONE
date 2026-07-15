import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JournalEntry, InvestmentEntry, Asset } from "@/generated/prisma/client";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (entry.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { title, content, entryType, tags, date, investmentEntryId } = body;

  // Ownership check para investmentEntryId
  if (investmentEntryId) {
    const invEntry = await prisma.investmentEntry.findUnique({ where: { id: investmentEntryId } });
    if (!invEntry || invEntry.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const updated = await prisma.journalEntry.update({
    where: { id },
    data: {
      ...(title             !== undefined && { title: title.trim() }),
      ...(content           !== undefined && { content: content.trim() }),
      ...(entryType         !== undefined && { entryType }),
      ...(tags              !== undefined && { tags }),
      ...(date              !== undefined && { date: new Date(date) }),
      ...(investmentEntryId !== undefined && { investmentEntryId: investmentEntryId ?? null }),
      // healthScoreAtTime: NUNCA atualizar — snapshot imutável
    },
    include: { investmentEntry: { include: { asset: true } } },
  });

  return NextResponse.json(serializeEntry(updated));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (entry.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.journalEntry.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

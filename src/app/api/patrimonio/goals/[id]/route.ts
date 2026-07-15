import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { FinancialGoalSerialized } from "../route";

const VALID_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

function serialize(goal: {
  id: string;
  name: string;
  targetAmount: unknown;
  savedAmount: unknown;
  contributionAmount: unknown;
  contributionFrequency: string;
  bank: string | null;
  notes: string | null;
  createdAt: Date;
}): FinancialGoalSerialized {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: toNumber(goal.targetAmount),
    savedAmount: toNumber(goal.savedAmount),
    contributionAmount: toNumber(goal.contributionAmount),
    contributionFrequency: goal.contributionFrequency as "DAILY" | "WEEKLY" | "MONTHLY",
    bank: goal.bank,
    notes: goal.notes,
    createdAt: goal.createdAt.toISOString(),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, targetAmount, savedAmount, contributionAmount, contributionFrequency, bank, notes } = body;

  const goal = await prisma.financialGoal.findUnique({ where: { id } });
  if (!goal || goal.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  if (targetAmount !== undefined && (typeof targetAmount !== "number" || targetAmount <= 0)) {
    return NextResponse.json({ error: "Valor alvo deve ser maior que zero" }, { status: 400 });
  }
  if (savedAmount !== undefined && (typeof savedAmount !== "number" || savedAmount < 0)) {
    return NextResponse.json({ error: "Valor poupado não pode ser negativo" }, { status: 400 });
  }
  if (contributionAmount !== undefined && (typeof contributionAmount !== "number" || contributionAmount <= 0)) {
    return NextResponse.json({ error: "Aporte deve ser maior que zero" }, { status: 400 });
  }
  if (contributionFrequency !== undefined && !VALID_FREQUENCIES.includes(contributionFrequency)) {
    return NextResponse.json({ error: "Frequência inválida" }, { status: 400 });
  }

  const updated = await prisma.financialGoal.update({
    where: { id },
    data: {
      ...(name && { name: name.trim() }),
      ...(targetAmount !== undefined && { targetAmount }),
      ...(savedAmount !== undefined && { savedAmount }),
      ...(contributionAmount !== undefined && { contributionAmount }),
      ...(contributionFrequency !== undefined && { contributionFrequency }),
      ...(bank !== undefined && { bank: bank ?? null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
    },
  });

  return NextResponse.json(serialize(updated));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const goal = await prisma.financialGoal.findUnique({ where: { id } });
  if (!goal || goal.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 403 });
  }

  await prisma.financialGoal.delete({ where: { id } });
  return NextResponse.json({}, { status: 204 });
}

import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import type { FinancialGoalSerialized } from "@/types/fire";
export type { FinancialGoalSerialized };

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

const VALID_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.financialGoal.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ goals: rows.map(serialize) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, targetAmount, savedAmount, contributionAmount, contributionFrequency, bank, notes } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }
  if (typeof targetAmount !== "number" || targetAmount <= 0) {
    return NextResponse.json({ error: "Valor alvo deve ser maior que zero" }, { status: 400 });
  }
  if (typeof savedAmount !== "number" || savedAmount < 0) {
    return NextResponse.json({ error: "Valor poupado não pode ser negativo" }, { status: 400 });
  }
  if (typeof contributionAmount !== "number" || contributionAmount <= 0) {
    return NextResponse.json({ error: "Aporte deve ser maior que zero" }, { status: 400 });
  }
  if (!VALID_FREQUENCIES.includes(contributionFrequency)) {
    return NextResponse.json({ error: "Frequência inválida" }, { status: 400 });
  }

  const goal = await prisma.financialGoal.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      targetAmount,
      savedAmount: savedAmount ?? 0,
      contributionAmount,
      contributionFrequency,
      bank: bank ?? null,
      notes: notes?.trim() || null,
    },
  });

  return NextResponse.json(serialize(goal), { status: 201 });
}

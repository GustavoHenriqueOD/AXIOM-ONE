import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import type { FireSettingsResponse } from "@/types/fire";
export type { FireSettingsResponse };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      fireMonthlyExpense: true,
      fireSWR: true,
      fireTargetMonthlyIncome: true,
      fireRetirementYears: true,
      fireTargetMonthlyContrib: true,
      fireTargetInvestedAmount: true,
      fireNumberManual: true,
    },
  });

  return NextResponse.json({
    monthlyExpense: user?.fireMonthlyExpense ? toNumber(user.fireMonthlyExpense) : null,
    swr: user?.fireSWR ? toNumber(user.fireSWR) : null,
    targetMonthlyIncome: user?.fireTargetMonthlyIncome
      ? toNumber(user.fireTargetMonthlyIncome)
      : null,
    retirementYears: user?.fireRetirementYears ?? null,
    targetMonthlyContrib: user?.fireTargetMonthlyContrib
      ? toNumber(user.fireTargetMonthlyContrib)
      : null,
    targetInvestedAmount: user?.fireTargetInvestedAmount
      ? toNumber(user.fireTargetInvestedAmount)
      : null,
    fiNumberManual: user?.fireNumberManual ? toNumber(user.fireNumberManual) : null,
  } satisfies FireSettingsResponse);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    monthlyExpense,
    swr,
    targetMonthlyIncome,
    retirementYears,
    targetMonthlyContrib,
    targetInvestedAmount,
    fiNumberManual,
  } = body;

  if (monthlyExpense !== null && monthlyExpense !== undefined && monthlyExpense <= 0)
    return NextResponse.json({ error: "Gasto deve ser maior que zero" }, { status: 400 });
  if (swr !== null && swr !== undefined && (swr < 0.5 || swr > 20))
    return NextResponse.json({ error: "SWR deve estar entre 0.5 e 20" }, { status: 400 });
  if (
    targetMonthlyIncome !== null &&
    targetMonthlyIncome !== undefined &&
    targetMonthlyIncome <= 0
  )
    return NextResponse.json({ error: "Renda alvo deve ser maior que zero" }, { status: 400 });
  if (
    retirementYears !== null &&
    retirementYears !== undefined &&
    (retirementYears < 1 || retirementYears > 60)
  )
    return NextResponse.json({ error: "Horizonte deve estar entre 1 e 60 anos" }, { status: 400 });
  if (fiNumberManual !== null && fiNumberManual !== undefined && fiNumberManual <= 0)
    return NextResponse.json({ error: "FI Number deve ser maior que zero" }, { status: 400 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(monthlyExpense !== undefined && { fireMonthlyExpense: monthlyExpense ?? null }),
      ...(swr !== undefined && { fireSWR: swr ?? null }),
      ...(targetMonthlyIncome !== undefined && {
        fireTargetMonthlyIncome: targetMonthlyIncome ?? null,
      }),
      ...(retirementYears !== undefined && { fireRetirementYears: retirementYears ?? null }),
      ...(targetMonthlyContrib !== undefined && {
        fireTargetMonthlyContrib: targetMonthlyContrib ?? null,
      }),
      ...(targetInvestedAmount !== undefined && {
        fireTargetInvestedAmount: targetInvestedAmount ?? null,
      }),
      ...(fiNumberManual !== undefined && { fireNumberManual: fiNumberManual ?? null }),
    },
  });

  return NextResponse.json({ ok: true });
}

import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { patrimonyGoal: true },
  });

  const goal = user?.patrimonyGoal ? toNumber(user.patrimonyGoal) : null;
  return NextResponse.json({ goal });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { goal } = await req.json();
  if (goal !== null && goal !== undefined && goal <= 0) {
    return NextResponse.json({ error: "Meta deve ser maior que zero" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { patrimonyGoal: goal ?? null },
  });

  return NextResponse.json({ goal: goal ?? null });
}

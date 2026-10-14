import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const userId = session.user.id;
  const dateFilter: { gte?: Date; lte?: Date } = {};

  if (start && !isNaN(Date.parse(start))) {
    dateFilter.gte = new Date(`${start}T00:00:00`);
  }
  if (end && !isNaN(Date.parse(end))) {
    dateFilter.lte = new Date(`${end}T23:59:59.999`);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
    orderBy: { date: "desc" },
    include: { category: true },
    take: 5000, // limite serverless-safe; usuários com +5k transações exportam em múltiplos períodos
  });

  // BOM UTF-8 para Excel reconhecer acentuação; ponto-e-vírgula como delimitador (padrão BR)
  const BOM = "﻿";
  const header = "Data;Descrição;Categoria;Tipo;Valor\n";
  const rows = transactions.map((tx) => {
    const date = tx.date.toISOString().slice(0, 10);
    const desc = `"${tx.description.replace(/"/g, '""')}"`;
    const cat = `"${tx.category.name.replace(/"/g, '""')}"`;
    const type = tx.type === "INCOME" ? "Receita" : "Despesa";
    const amount = toNumber(tx.amount).toFixed(2).replace(".", ",");
    return `${date};${desc};${cat};${type};${amount}`;
  });

  const csv = BOM + header + rows.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transacoes-axiom.csv"`,
      "X-Exported-Count": String(transactions.length),
    },
  });
}

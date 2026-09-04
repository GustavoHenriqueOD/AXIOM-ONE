import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFile } from "@/lib/import/parseFile";
import { matchCategory, buildLearnedMatcher } from "@/lib/import/matchCategory";

const ALLOWED_EXTENSIONS = ["ofx", "csv", "xlsx", "xls"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: `Formato não suportado. Use: ${ALLOWED_EXTENSIONS.join(", ")}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande. Máximo: 5MB" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parseFile(buffer, file.name);

    // Load user history and categories for smart matching
    const [existingTx, categories] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: session.user.id },
        select: { description: true, categoryId: true },
        orderBy: { date: "desc" },
        take: 2000,
      }),
      prisma.category.findMany({ where: { userId: session.user.id } }),
    ]);

    // Ensure Limbo category exists
    let limboCategory = categories.find((c) => c.name === "Limbo");
    if (!limboCategory) {
      limboCategory = await prisma.category.create({
        data: { name: "Limbo", color: "#6B7280", icon: "inbox", userId: session.user.id },
      });
      categories.push(limboCategory);
    }

    const catInputs = categories.map((c) => ({ id: c.id, name: c.name }));

    // Learn from non-Limbo transactions only
    const learnedMatcher = buildLearnedMatcher(
      existingTx.filter((tx) => tx.categoryId !== limboCategory!.id),
      catInputs
    );

    const enriched = rows.map((row) => ({
      ...row,
      suggestedCategoryId:
        matchCategory(row.cleanDescription, catInputs) ??
        learnedMatcher(row.cleanDescription) ??
        limboCategory!.id,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar arquivo";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

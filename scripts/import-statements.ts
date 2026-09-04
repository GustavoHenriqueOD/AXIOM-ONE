import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { parseXLSX } from "../src/lib/import/parseXLSX";
import { matchCategory, buildLearnedMatcher } from "../src/lib/import/matchCategory";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const FILES = [
  "/Users/gustavooliveira/Downloads/account_statement-019986cc-f1e5-4f9d-94ca-c97329a7728a.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-0327a549-4d0e-4647-982e-ce378e6f1ea9.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-0ede4f65-9ff9-47f5-953b-81cc6ded81c5.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-1fb4a336-0516-40e4-9881-ed4a72ea5d14.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-476661de-a9c1-4ee5-b6b4-c1a3dd043e21.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-7ababd58-1a9c-4285-b3f0-dd684644ef0e.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-91f7f7ff-d0a0-4557-9c38-9bd4c78ee4b9.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-a8db2f7e-7597-411d-a767-59d1e7c48013.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-b3ca1ff8-b991-4041-afab-4e7ca19cf3b3.xlsx",
  "/Users/gustavooliveira/Downloads/account_statement-bae12f10-5d31-4940-afe3-5c7dbcba722d.xlsx",
];

function dedupKey(date: string, amount: number, type: string, desc: string): string {
  return `${date}|${amount}|${type}|${desc.slice(0, 60)}`;
}

async function main() {
  console.log("🔍 Buscando usuário e categorias...");

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "test@axiom.com" },
  });

  const categories = await prisma.category.findMany({
    where: { userId: user.id },
  });

  if (!categories.length) {
    throw new Error("Nenhuma categoria encontrada. Rode o seed primeiro.");
  }

  // Ensure Limbo category exists
  let limboCategory = categories.find((c) => c.name === "Limbo");
  if (!limboCategory) {
    limboCategory = await prisma.category.create({
      data: { name: "Limbo", color: "#6B7280", icon: "inbox", userId: user.id },
    });
    categories.push(limboCategory);
  }

  console.log(`   Usuário: ${user.email}`);
  console.log(`   Categorias: ${categories.length} (fallback: Limbo)`);

  console.log("\n🔍 Carregando transações existentes para deduplicação e aprendizado...");
  const existing = await prisma.transaction.findMany({
    where: { userId: user.id },
    select: { date: true, amount: true, type: true, description: true, categoryId: true },
  });

  const existingKeys = new Set(
    existing.map((t) =>
      dedupKey(
        t.date.toISOString().slice(0, 10),
        parseFloat(String(t.amount)),
        t.type,
        t.description,
      )
    )
  );

  console.log(`   ${existingKeys.size} transações já existentes no banco`);

  // Build learned matcher from non-Limbo history
  const catInputs = categories.map((c) => ({ id: c.id, name: c.name }));
  const learnedMatcher = buildLearnedMatcher(
    existing.filter((tx) => tx.categoryId !== limboCategory!.id),
    catInputs
  );

  const toInsert: {
    description: string;
    amount: number;
    type: "INCOME" | "EXPENSE";
    date: Date;
    userId: string;
    categoryId: string;
  }[] = [];

  let totalParsed = 0;
  let skippedDuplicate = 0;
  let skippedEmpty = 0;
  let categorized = 0;
  let fallback = 0;

  console.log("\n📂 Processando arquivos...\n");

  for (const filePath of FILES) {
    const fileName = path.basename(filePath);
    const buf = fs.readFileSync(filePath);
    const rows = parseXLSX(buf);

    let fileInserted = 0;
    let fileDup = 0;

    for (const row of rows) {
      totalParsed++;

      if (!row.date || row.amount === 0) {
        skippedEmpty++;
        continue;
      }

      const key = dedupKey(row.date, row.amount, row.type, row.cleanDescription);

      if (existingKeys.has(key)) {
        skippedDuplicate++;
        fileDup++;
        continue;
      }

      existingKeys.add(key);

      const categoryId =
        matchCategory(row.cleanDescription, catInputs) ??
        learnedMatcher(row.cleanDescription);

      if (categoryId) {
        categorized++;
      } else {
        fallback++;
      }

      toInsert.push({
        description: row.cleanDescription || row.rawDescription,
        amount: row.amount,
        type: row.type,
        date: new Date(row.date),
        userId: user.id,
        categoryId: categoryId ?? limboCategory!.id,
      });

      fileInserted++;
    }

    console.log(
      `   ${fileName.slice(0, 20)}...  ${fileInserted} novas  |  ${fileDup} dup  |  ${rows.length} total`
    );
  }

  if (toInsert.length === 0) {
    console.log("\n⚠️  Nenhuma transação nova para inserir.");
    return;
  }

  console.log(`\n💾 Inserindo ${toInsert.length} transações...`);
  await prisma.transaction.createMany({ data: toInsert });

  console.log("\n" + "─".repeat(55));
  console.log(`✅ Import concluído!`);
  console.log(`   Arquivos processados : ${FILES.length}`);
  console.log(`   Linhas parseadas      : ${totalParsed}`);
  console.log(`   Inseridas             : ${toInsert.length}`);
  console.log(`   Duplicatas ignoradas  : ${skippedDuplicate}`);
  console.log(`   Categorizadas (auto)  : ${categorized}`);
  console.log(`   Fallback (Limbo)      : ${fallback}`);
  console.log("─".repeat(55));
}

main()
  .catch((e) => {
    console.error("❌ Erro:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

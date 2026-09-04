import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransactionList } from "@/components/transactions/TransactionList";

export default async function TransactionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [rawTransactions, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: session.user.id },
      orderBy: { date: "desc" },
      include: { category: true },
    }),
    prisma.category.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
    }),
  ]);

  const transactions = rawTransactions.map((tx) => ({
    ...tx,
    amount: parseFloat(String(tx.amount)),
    date: tx.date.toISOString(),
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-2xl font-semibold">Transações</h1>
      <TransactionList transactions={transactions} categories={categories} />
    </div>
  );
}

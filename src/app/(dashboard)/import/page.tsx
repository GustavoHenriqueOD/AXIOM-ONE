import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ImportWizard } from "@/components/import/ImportWizard";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let categories = await prisma.category.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
  });

  // Ensure Limbo exists so it appears in the category dropdown during preview
  if (!categories.find((c) => c.name === "Limbo")) {
    const limbo = await prisma.category.create({
      data: { name: "Limbo", color: "#6B7280", icon: "inbox", userId: session.user.id },
    });
    categories = [...categories, limbo].sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div>
      <ImportWizard categories={categories} />
    </div>
  );
}

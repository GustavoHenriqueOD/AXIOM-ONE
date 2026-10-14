# SPEC — v2.3: Budget & Alertas

**Status:** Aprovada (revisada em 2026-10-14)  
**Data:** 2026-10-14  
**Milestone GitHub:** v2.3  
**Issues:** #158 · #159 · #160 · #161 · #162 · #163

---

## 1. Resumo

Adiciona um sistema de orçamento por categoria com alertas automáticos em tempo real, mais exportação CSV de transações.

| Camada | O que muda |
|--------|-----------|
| Schema | Novo model `Budget` + relações em `User` e `Category` |
| API | 3 novas rotas (`/api/budget`, `/api/budget/[id]`, `/api/transactions/export`) + lógica de alerta em `POST /api/transactions` |
| Settings | Nova seção `BudgetManager` integrada ao `SettingsPage` |
| Dashboard | Novo widget `BudgetOverview` com barras de progresso |
| Transactions | Botão "Exportar CSV" no `TransactionList` |

**Resultado final:** o usuário define limites mensais por categoria nas Settings, acompanha o consumo no Dashboard com código de cor, recebe notificação quando atinge 80 % do limite, e pode exportar qualquer intervalo de transações para CSV.

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  SETTINGS PAGE                    DASHBOARD PAGE                │
│  ┌──────────────────┐            ┌──────────────────────────┐   │
│  │  BudgetManager   │            │    BudgetOverview        │   │
│  │  (Client)        │            │    (Client — "use client")│   │
│  │  - Lista cats    │            │  GET /api/budget          │   │
│  │  - Input limite  │            │  - ≤ 5 categorias         │   │
│  │  - Toggle on/off │            │  - verde/laranja/vermelho │   │
│  └──────┬───────────┘            └────────────┬─────────────┘   │
│         │                                     │                 │
└─────────┼─────────────────────────────────────┼─────────────────┘
          │ POST /api/budget                     │ GET /api/budget
          │ DELETE /api/budget/[id]              │
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  API ROUTES                                                     │
│                                                                 │
│  GET /api/budget      → Budget[] + currentSpend + percentUsed   │
│  POST /api/budget     → upsert por userId+categoryId            │
│  DELETE /api/budget/[id] → remove                               │
│                                                                 │
│  POST /api/transactions  (existente — MODIFICAR)                │
│    └─ após criar EXPENSE:                                       │
│         1. buscar Budget da categoria                           │
│         2. somar EXPENSE do mês corrente                        │
│         3. percentUsed = spend / monthlyLimit * 100             │
│         4. se >= 80% E notifBudgetAlerts E sem dedup →          │
│            prisma.notification.create (BUDGET_ALERT)            │
│                                                                 │
│  GET /api/transactions/export?start=&end=                       │
│    → CSV com Content-Disposition: attachment                    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  POSTGRESQL (Prisma)                                            │
│                                                                 │
│  Budget                                                         │
│   id · userId · categoryId · monthlyLimit · createdAt·updatedAt │
│   @@unique([userId, categoryId])                                │
│   @@index([userId])                                             │
└─────────────────────────────────────────────────────────────────┘

DEDUP ALERTA:
  mês atual = [1º dia do mês, agora]
  SELECT Notification WHERE userId + categoryId (no title) + type=BUDGET_ALERT
         AND createdAt >= startOfMonth → se existe, não cria
  Estratégia: title = "Orçamento: <categoryName>", lookup por userId+type+title+mês
```

---

## 3. Mudanças por Arquivo

### 3.1 CRIAR — `prisma/schema.prisma` (MODIFY)

**Issue #158**

```diff
+ model Budget {
+   id           String   @id @default(cuid())
+   userId       String
+   categoryId   String
+   monthlyLimit Decimal  @db.Decimal(10, 2)
+   createdAt    DateTime @default(now())
+   updatedAt    DateTime @updatedAt
+   user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
+   category     Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
+
+   @@unique([userId, categoryId])
+   @@index([userId])
+ }
```

Em `User`, adicionar após `financialGoals FinancialGoal[]`:
```diff
+   budgets            Budget[]
```

Em `Category`, adicionar após `wealthItems WealthItem[]`:
```diff
+   budgets  Budget[]
```

Em `Notification`, adicionar campo para dedup robusto de alertas:
```diff
  model Notification {
    id        String           @id @default(cuid())
    userId    String
    type      NotificationType
    title     String
    message   String
    read      Boolean          @default(false)
    createdAt DateTime         @default(now())
+   categoryId String?
    user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  }
```

Isso permite dedup por `userId + type + categoryId + createdAt >= startOfMonth` — robusto a renomes de categoria.

**Checklist #158:**
- [ ] Adicionar model `Budget` no schema
- [ ] Adicionar `budgets Budget[]` em `User`
- [ ] Adicionar `budgets Budget[]` em `Category`
- [ ] Adicionar `categoryId String?` em `Notification`
- [ ] Rodar `npx prisma migrate dev --name add-budget-notification-categoryid`
- [ ] Verificar geração do client (`src/generated/prisma`)

---

### 3.2 CRIAR — `src/app/api/budget/route.ts`

**Issue #159**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const budgets = await prisma.budget.findMany({
    where: { userId: session.user.id },
    include: { category: true },
    orderBy: { createdAt: "asc" },
  });

  const result = await Promise.all(
    budgets.map(async (b) => {
      const agg = await prisma.transaction.aggregate({
        where: {
          userId: session.user.id,
          categoryId: b.categoryId,
          type: "EXPENSE",
          date: { gte: startOfMonth },
        },
        _sum: { amount: true },
      });
      const currentSpend = toNumber(agg._sum.amount ?? 0);
      const limit = toNumber(b.monthlyLimit);
      const percentUsed = limit > 0 ? (currentSpend / limit) * 100 : 0;

      return {
        id: b.id,
        categoryId: b.categoryId,
        categoryName: b.category.name,
        categoryColor: b.category.color,
        monthlyLimit: limit,
        currentSpend,
        percentUsed: Math.round(percentUsed * 10) / 10,
      };
    })
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { categoryId, monthlyLimit } = body;

  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId é obrigatório" }, { status: 400 });
  }
  if (typeof monthlyLimit !== "number" || monthlyLimit <= 0) {
    return NextResponse.json({ error: "monthlyLimit deve ser maior que zero" }, { status: 400 });
  }

  // Ownership check
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== session.user.id) {
    return NextResponse.json({ error: "Categoria não encontrada" }, { status: 403 });
  }

  const budget = await prisma.budget.upsert({
    where: { userId_categoryId: { userId: session.user.id, categoryId } },
    create: { userId: session.user.id, categoryId, monthlyLimit },
    update: { monthlyLimit },
  });

  return NextResponse.json({ ...budget, monthlyLimit: toNumber(budget.monthlyLimit) }, { status: 200 });
}
```

**Checklist #159a (GET + POST):**
- [ ] Criar `src/app/api/budget/route.ts`
- [ ] GET retorna array com `currentSpend` e `percentUsed`
- [ ] POST faz upsert — idempotente por `userId+categoryId`
- [ ] Ownership check na categoria antes do upsert

---

### 3.3 CRIAR — `src/app/api/budget/[id]/route.ts`

**Issue #159**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const budget = await prisma.budget.findUnique({ where: { id } });

  if (!budget || budget.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  await prisma.budget.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
```

**Checklist #159b (DELETE):**
- [ ] Criar `src/app/api/budget/[id]/route.ts`
- [ ] Ownership check antes de deletar
- [ ] Retornar 204 em caso de sucesso

---

### 3.4 MODIFICAR — `src/app/api/transactions/route.ts`

**Issue #162 — Alertas automáticos por orçamento de categoria**

Substituir a função `generateTransactionNotifications` existente por uma versão ampliada. A lógica de alerta global (80% da renda) é mantida; adiciona-se alerta por categoria quando há `Budget` configurado.

Inserir helper **após** os imports existentes, antes da função `generateTransactionNotifications`:

```ts
// Helper: alerta por orçamento de categoria (dedup por mês)
async function checkCategoryBudgetAlert(
  userId: string,
  categoryId: string,
  categoryName: string
) {
  const budget = await prisma.budget.findUnique({
    where: { userId_categoryId: { userId, categoryId } },
  });
  if (!budget) return;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const agg = await prisma.transaction.aggregate({
    where: { userId, categoryId, type: "EXPENSE", date: { gte: startOfMonth } },
    _sum: { amount: true },
  });

  const spent = toNumber(agg._sum.amount ?? 0);
  const limit = toNumber(budget.monthlyLimit);
  const pct = limit > 0 ? (spent / limit) * 100 : 0;

  if (pct < 80) return;

  // Dedup: 1 alerta por categoria por mês (busca por categoryId — robusto a renomes)
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: "BUDGET_ALERT",
      categoryId,
      createdAt: { gte: startOfMonth },
    },
  });
  if (existing) return;

  const label = pct >= 100 ? "ultrapassou" : `atingiu ${Math.round(pct)}% de`;
  await prisma.notification.create({
    data: {
      userId,
      type: "BUDGET_ALERT",
      title: `Orçamento: ${categoryName}`,
      message: `Você ${label} o limite mensal de "${categoryName}".`,
      categoryId,
    },
  });
}
```

Dentro de `generateTransactionNotifications`, após o bloco `if (user.notifBudgetAlerts && tx.type === "EXPENSE") { ... }`, adicionar:

```ts
  // Alerta específico por orçamento de categoria
  if (user.notifBudgetAlerts && tx.type === "EXPENSE" && tx.categoryId) {
    await checkCategoryBudgetAlert(userId, tx.categoryId, tx.categoryName);
  }
```

Atualizar assinatura do tipo do parâmetro para incluir `categoryId`:

```ts
async function generateTransactionNotifications(
  userId: string,
  tx: { description: string; amount: number; type: string; categoryName: string; categoryId: string }
)
```

E na chamada (linha ~138 do arquivo original):

```ts
generateTransactionNotifications(session.user.id, {
  description: description.trim(),
  amount,
  type,
  categoryName: transaction.category.name,
  categoryId: transaction.categoryId,       // <-- novo campo
}).catch(() => {});
```

**Checklist #162:**
- [ ] Adicionar helper `checkCategoryBudgetAlert`
- [ ] Atualizar assinatura de `generateTransactionNotifications` (adicionar `categoryId`)
- [ ] Chamar `checkCategoryBudgetAlert` dentro do bloco de notif (fire-and-forget já cobre)
- [ ] Dedup: lookup por `userId + type + categoryId + createdAt >= startOfMonth` (não por string de título)
- [ ] Salvar `categoryId` no `create` da Notification para dedup futuro
- [ ] Atualizar chamada do helper na rota POST para passar `categoryId`

---

### 3.5 CRIAR — `src/app/api/transactions/export/route.ts`

**Issue #163**

```ts
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

  const where: Parameters<typeof prisma.transaction.findMany>[0]["where"] = {
    userId: session.user.id,
  };

  if (start && !isNaN(Date.parse(start))) {
    where.date = { ...((where.date as object) ?? {}), gte: new Date(`${start}T00:00:00`) };
  }
  if (end && !isNaN(Date.parse(end))) {
    where.date = { ...((where.date as object) ?? {}), lte: new Date(`${end}T23:59:59.999`) };
  }

  const transactions = await prisma.transaction.findMany({
    where,
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
```

**Checklist #163a (API):**
- [ ] Criar `src/app/api/transactions/export/route.ts`
- [ ] Suportar `?start=YYYY-MM-DD&end=YYYY-MM-DD` (ambos opcionais)
- [ ] Delimitador ponto-e-vírgula + BOM UTF-8 (padrão Excel BR)
- [ ] Vírgula decimal (`1234,56`), aspas duplas em campos com texto livre
- [ ] `take: 5000` como limite de segurança + header `X-Exported-Count`
- [ ] `Content-Disposition: attachment` com nome de arquivo fixo

---

### 3.6 CRIAR — `src/components/settings/BudgetManager.tsx`

**Issue #160**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Trash2, Plus } from "lucide-react";
import type { Category } from "@/generated/prisma/client";

interface BudgetEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  monthlyLimit: number;
  currentSpend: number;
  percentUsed: number;
}

interface BudgetManagerProps {
  categories: Category[];
}

export function BudgetManager({ categories }: BudgetManagerProps) {
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCatId, setSelectedCatId] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then((data) => setBudgets(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Categorias sem orçamento cadastrado
  const availableCats = categories.filter(
    (c) => !budgets.some((b) => b.categoryId === c.id)
  );

  async function handleAdd() {
    if (!selectedCatId || !limitValue || Number(limitValue) <= 0) {
      toast.error("Erro", "Selecione uma categoria e informe um limite válido");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: selectedCatId, monthlyLimit: Number(limitValue) }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast.error("Erro", d.error ?? "Não foi possível salvar");
        return;
      }
      // Refresh lista completa para obter currentSpend e percentUsed
      const refreshed = await fetch("/api/budget").then((r) => r.json());
      setBudgets(Array.isArray(refreshed) ? refreshed : []);
      setSelectedCatId("");
      setLimitValue("");
      toast.success("Sucesso!", "Orçamento salvo");
    } catch {
      toast.error("Erro", "Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/budget/${id}`, { method: "DELETE" });
      if (res.ok) {
        setBudgets((prev) => prev.filter((b) => b.id !== id));
        toast.success("Sucesso!", "Orçamento removido");
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error("Erro", d.error ?? "Não foi possível remover");
      }
    } catch {
      toast.error("Erro", "Erro de conexão");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="animate-pulse h-24 bg-axiom-hover rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      {/* Formulário de adição */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={selectedCatId}
          onChange={(e) => setSelectedCatId(e.target.value)}
          className="flex-1 min-w-40 h-9 rounded-lg bg-axiom-hover border border-axiom-border text-white text-sm px-3 focus:border-axiom-primary outline-none"
        >
          <option value="">Selecionar categoria...</option>
          {availableCats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Limite mensal (R$)"
          value={limitValue}
          onChange={(e) => setLimitValue(e.target.value)}
          className="w-44 bg-axiom-hover border-axiom-border text-white placeholder:text-axiom-muted focus:border-axiom-primary"
        />
        <Button
          onClick={handleAdd}
          disabled={saving}
          className="bg-axiom-primary hover:bg-axiom-primary/90 text-white gap-1.5 h-9 text-sm"
        >
          <Plus size={15} />
          Adicionar
        </Button>
      </div>

      {/* Lista de orçamentos */}
      {budgets.length === 0 ? (
        <p className="text-axiom-muted text-sm text-center py-6">
          Nenhum orçamento configurado. Adicione um limite para começar.
        </p>
      ) : (
        <div className="border border-axiom-border rounded-xl divide-y divide-axiom-border overflow-hidden">
          {budgets.map((b) => {
            const barColor =
              b.percentUsed >= 100
                ? "bg-axiom-expense"
                : b.percentUsed >= 80
                ? "bg-axiom-primary"
                : "bg-axiom-income";
            return (
              <div key={b.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: b.categoryColor }}
                    />
                    <span className="text-white text-sm font-medium">{b.categoryName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-xs font-medium",
                      b.percentUsed >= 100 ? "text-axiom-expense" : b.percentUsed >= 80 ? "text-axiom-primary" : "text-axiom-muted"
                    )}>
                      R$ {b.currentSpend.toFixed(2)} / R$ {b.monthlyLimit.toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleDelete(b.id)}
                      disabled={deletingId === b.id}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-axiom-muted hover:text-axiom-expense hover:bg-axiom-expense/10 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="w-full bg-axiom-hover rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${Math.min(b.percentUsed, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Checklist #160a (componente):**
- [ ] Criar `src/components/settings/BudgetManager.tsx`
- [ ] Fetch inicial de `/api/budget` no `useEffect`
- [ ] Formulário: select de categorias sem orçamento + input de limite
- [ ] Barra de progresso com cores axiom (income/primary/expense)
- [ ] Delete com feedback toast e atualização local
- [ ] Loading state com skeleton `animate-pulse`

---

### 3.7 MODIFICAR — `src/components/settings/SettingsPage.tsx`

**Issue #160 — Adicionar aba "Orçamentos"**

Adicionar import no topo do arquivo:
```ts
import { BudgetManager } from "./BudgetManager";
```

Adicionar `categories` na interface `SettingsPageProps`:
```ts
interface SettingsPageProps {
  // ...existentes...
  categories: Category[];
}
```

Adicionar `import type { Category } from "@/generated/prisma/client";` se ainda não presente.

Adicionar nova section antes de `{/* ── Data & Backup ── */}`:
```tsx
{/* ── Orçamentos ── */}
<section className="bg-axiom-card border border-axiom-border rounded-xl p-6">
  <div className="flex items-center gap-2 mb-6">
    <DollarSign size={16} className="text-axiom-muted" />
    <h2 className="text-white font-semibold text-base">Orçamentos Mensais</h2>
  </div>
  <p className="text-axiom-muted text-xs mb-4">
    Defina um limite de gastos mensal por categoria. Você receberá um alerta ao atingir 80% do limite.
  </p>
  <BudgetManager categories={categories} />
</section>
```

**Checklist #160b (SettingsPage):**
- [ ] Importar `BudgetManager`
- [ ] Adicionar `categories: Category[]` na interface `SettingsPageProps`
- [ ] Renderizar section "Orçamentos Mensais" antes de Data & Backup
- [ ] Passar `categories={categories}` para `BudgetManager`

---

### 3.8 MODIFICAR — `src/app/(dashboard)/settings/page.tsx`

**Issue #160 — Buscar categorias no Server Component de Settings**

```diff
- const [user, currencies] = await Promise.all([
+ const [user, currencies, categories] = await Promise.all([
    prisma.user.findUnique({ ... }),
    prisma.userCurrency.findMany({ ... }),
+   prisma.category.findMany({
+     where: { userId: session.user.id },
+     orderBy: { name: "asc" },
+   }),
  ]);
```

E na renderização:
```diff
  <SettingsPage
    user={user}
    currencies={currencies}
    currentTheme={currentTheme}
    currentLocale={currentLocale}
    notifPrefs={{ ... }}
+   categories={categories}
  />
```

**Checklist #160c (page.tsx):**
- [ ] Buscar `categories` em paralelo com `user` e `currencies`
- [ ] Passar `categories` para `SettingsPage`

---

### 3.9 CRIAR — `src/components/dashboard/BudgetOverview.tsx`

**Issue #161**

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";

interface BudgetEntry {
  id: string;
  categoryName: string;
  categoryColor: string;
  monthlyLimit: number;
  currentSpend: number;
  percentUsed: number;
}

export function BudgetOverview() {
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then((data: BudgetEntry[]) => {
        if (Array.isArray(data)) {
          // Ordenar por percentUsed desc, limitar a 5
          setBudgets(data.sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 5));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!loading && budgets.length === 0) return null; // Ocultar se não há orçamentos

  return (
    <div className="bg-axiom-card border border-axiom-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Target size={16} className="text-axiom-primary" />
        <h3 className="text-white font-semibold">Orçamentos do Mês</h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-axiom-hover rounded mb-1.5 w-3/4" />
              <div className="h-1.5 bg-axiom-hover rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const barColor =
              b.percentUsed >= 100
                ? "bg-axiom-expense"
                : b.percentUsed >= 80
                ? "bg-axiom-primary"
                : "bg-axiom-income";
            const textColor =
              b.percentUsed >= 100
                ? "text-axiom-expense"
                : b.percentUsed >= 80
                ? "text-axiom-primary"
                : "text-axiom-muted";

            return (
              <div key={b.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: b.categoryColor }}
                    />
                    <span className="text-white text-sm">{b.categoryName}</span>
                  </div>
                  <span className={cn("text-xs font-medium", textColor)}>
                    {b.percentUsed.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-axiom-hover rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${Math.min(b.percentUsed, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Checklist #161:**
- [ ] Criar `src/components/dashboard/BudgetOverview.tsx`
- [ ] Fetch `/api/budget`, ordenar por `percentUsed` desc, limitar a 5
- [ ] Retornar `null` se não há budgets (widget invisível por padrão)
- [ ] Skeleton `animate-pulse` enquanto carrega
- [ ] Cores: `bg-axiom-income` < 80%, `bg-axiom-primary` 80–100%, `bg-axiom-expense` > 100%

---

### 3.10 MODIFICAR — `src/app/(dashboard)/dashboard/page.tsx`

**Issue #161 — Adicionar BudgetOverview abaixo de RecentTransactions**

```diff
+ import { BudgetOverview } from "@/components/dashboard/BudgetOverview";
```

```diff
  {/* Recent Transactions */}
  <RecentTransactions transactions={data.recentTransactions} currency={data.currency} />
+
+ {/* Budget Overview */}
+ <BudgetOverview />
```

**Checklist #161b:**
- [ ] Importar `BudgetOverview`
- [ ] Renderizar após `<RecentTransactions />`
- [ ] Não requer props (fetcha diretamente do client)

---

### 3.11 MODIFICAR — `src/components/transactions/TransactionList.tsx`

**Issue #163 — Botão "Exportar CSV"**

Adicionar import:
```ts
import { Download } from "lucide-react";
```

Adicionar função de export (dentro do componente, antes do return):
```ts
function handleExportCSV() {
  // Determina intervalo baseado no filtro de mês ativo
  let start: string | undefined;
  let end: string | undefined;

  if (filters.month) {
    const [y, m] = filters.month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    start = `${filters.month}-01`;
    end = `${filters.month}-${String(last).padStart(2, "0")}`;
  }

  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const url = `/api/transactions/export${params.toString() ? "?" + params.toString() : ""}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = "transacoes-axiom.csv";
  a.click();
}
```

Na barra de ações (ao lado do botão "Nova transação"):
```tsx
<Button
  onClick={handleExportCSV}
  variant="outline"
  className="border-axiom-border text-axiom-muted hover:text-white hover:bg-axiom-hover gap-1.5 h-9 text-sm shrink-0"
>
  <Download size={15} />
  Exportar CSV
</Button>
```

**Checklist #163b (UI):**
- [ ] Importar `Download` do lucide-react
- [ ] Adicionar `handleExportCSV` com `createElement("a").click()` (não `window.open`)
- [ ] Botão ao lado de "Nova transação" (variant outline, tokens axiom)
- [ ] Respeitar filtro de mês ativo ao montar os query params

---

## 4. Ordem de Implementação

```
1. [#158] Schema + migration
         └─ prisma migrate dev → garante client gerado antes de tudo

2. [#159] API /api/budget (GET + POST) e /api/budget/[id] (DELETE)
         └─ base para todos os outros itens

3. [#162] Alerta por orçamento em POST /api/transactions
         └─ depende do model Budget existir (step 1) e da API (step 2 — só o model)

4. [#160] BudgetManager + SettingsPage + settings/page.tsx
         └─ depende da API (step 2)

5. [#161] BudgetOverview + dashboard/page.tsx
         └─ depende da API (step 2)

6. [#163] Export CSV — API + botão TransactionList
         └─ independente, pode ser feito em paralelo com 4 e 5

QA após cada step: npm run build (zero erros TypeScript)
QA final antes do commit: npm run build completo
```

---

## 5. Issues Sugeridas

### #158 — Schema Budget + Migration

**Título:** `feat(v2.3): adicionar model Budget ao schema Prisma`

**Descrição:**
- Adicionar model `Budget` com campos: `id`, `userId`, `categoryId`, `monthlyLimit`, `createdAt`, `updatedAt`
- Constraints: `@@unique([userId, categoryId])`, `@@index([userId])`
- Relações `onDelete: Cascade` em User e Category
- Adicionar `budgets Budget[]` em `User` e `Category`
- Rodar `npx prisma migrate dev --name add-budget`
- Verificar que client Prisma é regenerado em `src/generated/prisma`

**Critérios de aceite:**
- `npx prisma migrate dev` executa sem erros
- Model `Budget` disponível no client gerado

---

### #159 — API `/api/budget`

**Título:** `feat(v2.3): criar API /api/budget (GET, POST, DELETE)`

**Descrição:**
- `GET /api/budget` → lista budgets com `currentSpend` (soma EXPENSE no mês) e `percentUsed`
- `POST /api/budget` → upsert por `userId+categoryId` (body: `{ categoryId, monthlyLimit }`)
- `DELETE /api/budget/[id]` → remove orçamento (ownership check, 204 em sucesso)
- Seguir padrão de auth da API: `const session = await auth(); if (!session?.user?.id) return 401`
- Serializar `monthlyLimit` com `toNumber()` antes de retornar

**Critérios de aceite:**
- GET retorna array com `id`, `categoryId`, `categoryName`, `categoryColor`, `monthlyLimit`, `currentSpend`, `percentUsed`
- POST é idempotente (upsert)
- DELETE retorna 404 se orçamento não existe ou não pertence ao usuário

---

### #160 — BudgetManager em Settings

**Título:** `feat(v2.3): BudgetManager em Settings — gerenciar limites mensais`

**Descrição:**
- Criar `src/components/settings/BudgetManager.tsx` — Client Component
- Listar categorias disponíveis (sem orçamento cadastrado) em select
- Input para valor do limite (número > 0)
- Botão "Adicionar" que chama `POST /api/budget`
- Lista de orçamentos existentes com barra de progresso e delete
- Cores de progresso: `bg-axiom-income` < 80%, `bg-axiom-primary` 80–99%, `bg-axiom-expense` ≥ 100%
- Adicionar seção "Orçamentos Mensais" em `SettingsPage.tsx`
- Buscar `categories` em `settings/page.tsx` e passar para `SettingsPage`

**Critérios de aceite:**
- Usuário consegue adicionar, visualizar e remover orçamentos na aba Settings
- Barra de progresso reflete o gasto do mês corrente
- Toast de sucesso/erro em todas as ações

---

### #161 — BudgetOverview no Dashboard

**Título:** `feat(v2.3): widget BudgetOverview no Dashboard`

**Descrição:**
- Criar `src/components/dashboard/BudgetOverview.tsx` — Client Component
- Fetch `GET /api/budget` no `useEffect` (sem props do servidor)
- Mostrar até 5 categorias ordenadas por `percentUsed` desc
- Barras de progresso com cores axiom (income/primary/expense)
- Retornar `null` se não há orçamentos configurados (widget invisível)
- Skeleton `animate-pulse` enquanto carrega
- Adicionar após `<RecentTransactions />` em `dashboard/page.tsx`

**Critérios de aceite:**
- Widget aparece apenas se o usuário tem pelo menos 1 orçamento
- Cores corretas: verde < 80%, laranja 80–100%, vermelho > 100%
- Não bloqueia renderização do dashboard (Client Component assíncrono)

---

### #162 — Alertas automáticos por orçamento de categoria

**Título:** `feat(v2.3): alertas automáticos ao atingir 80% do limite por categoria`

**Descrição:**
- Modificar `POST /api/transactions/route.ts`
- Após criar uma EXPENSE, verificar se a categoria tem `Budget` cadastrado
- Calcular `percentUsed = spent / monthlyLimit * 100` (soma EXPENSE no mês)
- Se `percentUsed >= 80` e `user.notifBudgetAlerts = true`:
  - Dedup: buscar `Notification` com `type=BUDGET_ALERT`, `title="Orçamento: <categoryName>"`, `createdAt >= startOfMonth`
  - Se não existe, criar Notification com mensagem descritiva
- Helper assíncrono `checkCategoryBudgetAlert` — encapsulado e chamado dentro do fire-and-forget existente

**Critérios de aceite:**
- Notificação criada na primeira transação que ultrapassa 80%
- Apenas 1 alerta por categoria por mês (dedup funcional)
- Usuários com `notifBudgetAlerts = false` não recebem alertas
- Não bloqueia resposta da rota POST (fire-and-forget)

---

### #163 — Export CSV

**Título:** `feat(v2.3): exportar transações para CSV`

**Descrição:**
- Criar `GET /api/transactions/export?start=YYYY-MM-DD&end=YYYY-MM-DD`
- Retornar CSV com header: `Data;Descrição;Categoria;Tipo;Valor` (delimitador `;` — padrão Excel BR)
- BOM UTF-8 no início do arquivo para acentuação correta no Excel
- Valor com vírgula decimal (`1234,56`), strings com aspas duplas, `take: 5000`
- `Content-Disposition: attachment; filename="transacoes-axiom.csv"`
- Download via `createElement("a").click()` (evita bloqueio de popup blocker)
- Se filtro de mês ativo, passar `start` e `end` correspondentes ao mês

**Critérios de aceite:**
- Download inicia ao clicar no botão
- CSV abre corretamente em Excel/Google Sheets
- Respeitear filtro de mês ativo
- Sem filtro: exporta todas as transações

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| N+1 queries no GET `/api/budget` | Alta | Médio | Aceitável para poucos budgets por usuário (≤50). Se escalar, usar `groupBy` + `_sum` em query única |
| Migration falha se DB tem FK constraints implícitas | Baixa | Alto | Testar `prisma migrate dev` em ambiente local antes do merge |
| Dedup de alertas falha se categoria é renomeada mid-mês | Baixa | Baixo | ✅ Resolvido: dedup por `categoryId` (não por string de título) — robusto a renomes |
| Export CSV com transações > 5k linhas gera timeout | Baixa | Médio | ✅ Resolvido: `take: 5000` + header `X-Exported-Count` — usuário exporta por período |
| `BudgetOverview` aparece em dashboard sem dados → layout quebrado | Baixa | Baixo | `if (!loading && budgets.length === 0) return null` — widget invisível por padrão |
| `window.open` para export bloqueado por popup blocker | Baixa | Baixo | ✅ Resolvido: `createElement("a").click()` — sem popup, download direto |
| CSV com vírgula como delimitador conflita com vírgula decimal BR | Alta | Alto | ✅ Resolvido: delimitador `;` + BOM UTF-8 (padrão Excel BR) |
| `SettingsPage` com prop `categories` quebra build se não passada | Alta | Alto | Atualizar `settings/page.tsx` **junto** com `SettingsPage.tsx` na mesma issue (#160) |

### Observações Adicionais

**Compatibilidade com notificação global existente:** A lógica atual em `generateTransactionNotifications` já verifica "80% da renda total" (alerta global). O novo `checkCategoryBudgetAlert` é um alerta **por categoria** independente — ambos coexistem sem conflito.

**Serialização:** Em todos os endpoints que retornam `Budget.monthlyLimit` (Decimal Prisma), usar `toNumber()` de `@/lib/utils` antes de serializar.

**CSS:** Nenhum novo token axiom é necessário — a feature usa apenas os tokens existentes (`axiom-income`, `axiom-primary`, `axiom-expense`, `axiom-muted`, `axiom-card`, `axiom-border`, `axiom-hover`).

**shadcn:** Nenhum componente shadcn novo necessário — a feature usa apenas `Button`, `Input` e `select` nativo estilizado.

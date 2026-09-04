# PRD — Roadmap Axiom One v2.2 → v2.7

> Gerado após auditoria completa do codebase em 2026-04-25.
> Este documento é a fonte de verdade para as próximas milestones.

---

## Contexto

A auditoria identificou três categorias de trabalho a seguir:

1. **Consolidação** — código duplicado, endpoints confusos, error handling silencioso, componentes gigantes
2. **Performance** — falta de índices, queries all-time em memória, sem paginação, sem cache por usuário
3. **Features que faltam** — budget por categoria, notificações por email, export, cost basis de investimentos, reconciliação no import

O projeto está pronto para uso (21 milestones entregues), mas precisa maturar antes de crescer. As milestones seguem essa ordem: consolidar → performance → features.

---

## Decisões Globais (valem para todas as milestones)

### O que estamos simplificando / removendo

| Item | Ação | Motivo |
|------|------|--------|
| `i18n` em 7 idiomas (hi, ar, zh, es, fr) | Reduzir para pt-BR + en | App pessoal; suporte real só faz sentido para 2 idiomas |
| `/api/patrimonio/goal` (singular) | Renomear para `/api/patrimonio/target` | Conflito de nomenclatura com `/api/patrimonio/goals` |
| 6 rotas de settings fragmentadas | Consolidar em PATCH único `/api/settings` | Menos round-trips, API mais simples |
| `catch {}` silenciosos | Substituir por resposta de erro visível ao usuário | Usuário não sabe quando algo falha |
| Lógica duplicada de Decimal | Extrair `toNumber()` em `src/lib/utils.ts` | `parseFloat(String(val))` repetido 70x |
| Validações duplicadas por rota | Extrair `src/lib/validators.ts` | Cada rota reimplementa os mesmos checks |

### O que NÃO vamos implementar (descartado)

- Monte Carlo simulations — custo computacional alto, retorno baixo para uso pessoal
- Offline / Service Worker — escopo de app mobile, não faz sentido no momento
- Sentiment analysis no Journal — gimmick sem valor prático agora
- Tax lots FIFO/LIFO detalhado — complexidade alta para usuário pessoa física
- Sharing / multi-usuário — não é app colaborativo

---

## Milestone v2.2 — Consolidação Técnica

**Objetivo:** Pagar a dívida técnica crítica antes de adicionar features. Sem essa milestone, cada nova feature fica mais difícil.

**Duração estimada:** 1 semana

---

### Issues

#### #152 — Índices no banco (Prisma)

**Motivação:** Reports all-time (networth, overview, cashflow) fazem full table scan em `Transaction` e `InvestmentEntry`. Com 5k+ transações, isso fica lento.

**O que fazer:**
```prisma
// Transaction
@@index([userId, date])
@@index([userId, type])
@@index([userId, categoryId])

// InvestmentEntry
@@index([userId, date])
@@index([userId, assetId])

// JournalEntry
@@index([userId, date])

// WealthItem
@@index([userId, itemType])
```

**Arquivos:** `prisma/schema.prisma` + migration

**Critério de aceite:** `prisma migrate dev` roda sem erro; queries de report usam índice (verificar via `EXPLAIN ANALYZE` no Neon console)

---

#### #153 — `toNumber()` helper + `lib/validators.ts`

**Motivação:** `parseFloat(String(val))` aparece ~70x. Validações de campo são reimplementadas em cada rota.

**O que fazer:**

`src/lib/utils.ts` — adicionar:
```ts
export function toNumber(val: unknown): number {
  return parseFloat(String(val ?? 0)) || 0;
}
```

`src/lib/validators.ts` — criar apenas os dois casos realmente repetidos:
```ts
export function validateAmount(val: unknown): number | null { ... }
export function validateDate(val: unknown): Date | null { ... }
```

`validateString` e `validateEnum` não são necessários agora — TypeScript strict já cobre esses casos via tipagem do body JSON. Substituir `parseFloat(String(` por `toNumber(` nas API routes.

**Arquivos:** `src/lib/utils.ts`, novo `src/lib/validators.ts`, todas as rotas em `src/app/api/`

**Critério de aceite:** `npm run build` sem erros; nenhum `parseFloat(String(` fora de `utils.ts`

---

#### #154 — Renomear `/api/patrimonio/goal` → `/api/patrimonio/target`

**Motivação:** `/goal` (patrimônio total alvo) vs `/goals` (lista de metas) — nomes ambíguos causam confusão.

**O que fazer:**
- Renomear pasta: `src/app/api/patrimonio/goal/` → `src/app/api/patrimonio/target/`
- Atualizar todos os fetch calls que apontam para `/api/patrimonio/goal`
- Buscar: `PatrimonioGoal.tsx`, `PatrimonioShell.tsx`

**Arquivos:** `src/app/api/patrimonio/goal/route.ts` (renomear), `src/components/patrimonio/PatrimonioGoal.tsx`, `src/components/patrimonio/PatrimonioShell.tsx`

**Critério de aceite:** `/api/patrimonio/goal` retorna 404; `/api/patrimonio/target` funciona; UI de meta patrimônio funciona

---

#### #155 — Consolidar settings em PATCH único

**Motivação:** 6 rotas separadas para atualizar avatar, tema, locale, notificações, perfil, senha. Desnecessariamente fragmentado.

**O que fazer:**
- Manter `/api/settings/password` separado (fluxo de segurança distinto)
- Consolidar `avatar`, `theme`, `locale`, `notifications`, `profile` em `PATCH /api/settings`
  ```ts
  // Body aceita qualquer subconjunto:
  { name?, email?, theme?, locale?, notifTransactions?, notifBudgetAlerts?, notifMonthlyReport? }
  ```
- **Importante:** o email de alerta de perfil (já em `src/lib/email.ts`) só deve disparar quando `name` ou `email` estiverem presentes no body — nunca para mudanças de tema/locale/notificações
- Atualizar `SettingsPage.tsx` e sub-forms para usar a nova rota

**Arquivos:** novo `src/app/api/settings/route.ts`, remover 5 rotas antigas, `src/components/settings/SettingsPage.tsx`, `ProfileForm.tsx`

**Critério de aceite:** Todas as configurações de settings salvam via PATCH único; senha mantém rota própria

---

#### #156 — Corrigir error handling silencioso

**Motivação:** Vários `catch {}` no client não mostram nada ao usuário. Falha silenciosa = experiência ruim.

**O que fazer:**
- Mapear todos os `catch` em Client Components (`InvestmentsShell`, `FireDashboard`, `PatrimonioShell`, `ReportsShell`)
- Adicionar estado `error: string | null` em cada shell
- Mostrar toast ou inline error message quando fetch falhar
- Usar `src/lib/toast.ts` + `src/components/ui/toaster.tsx` (já existem no projeto) ou `<div className="text-axiom-expense">` inline para erros persistentes

**Arquivos:** `src/components/patrimonio/*.tsx`, `src/components/investments/*.tsx`, `src/components/reports/ReportsShell.tsx`

**Critério de aceite:** Desligar a internet e abrir qualquer aba — deve aparecer mensagem de erro, não tela em branco

---

#### #157 — Extrair `AssetSelector` do `EntryDialog`

**Motivação:** `EntryDialog.tsx` tem 663 linhas com 3 responsabilidades misturadas (modal + seleção de ativo + busca de ticker).

**O que fazer:**
- Criar `src/components/investments/entries/AssetSelector.tsx`
  - Props: `assets[]`, `onSelect(asset)`, `onCreateInline(name, type, ticker?)`, `allowTickerSearch`
  - Encapsula: lista de ativos existentes, campo "novo ativo", busca de ticker B3/cripto
- `EntryDialog.tsx` passa a usar `<AssetSelector>` — fica em ~350 linhas

**Arquivos:** novo `src/components/investments/entries/AssetSelector.tsx`, `src/components/investments/entries/EntryDialog.tsx`

**Critério de aceite:** Comportamento idêntico ao atual; `EntryDialog.tsx` < 400 linhas; `AssetSelector` pode ser reutilizado em outros contextos

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Foundation | #152 (índices), #153 (helpers) |
| 2 — API | #154 (renomear goal), #155 (consolidar settings) |
| 3 — UI | #156 (error handling), #157 (AssetSelector) |

---

## Milestone v2.3 — Budget & Alertas

**Objetivo:** A lacuna funcional mais sentida — usuário não tem como definir metas de gasto por categoria nem receber alertas quando ultrapassar.

**Duração estimada:** 1–2 semanas

---

### Novo Model

```prisma
model Budget {
  id          String   @id @default(cuid())
  userId      String
  categoryId  String
  monthlyLimit Decimal @db.Decimal(10, 2)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([userId, categoryId])
  @@index([userId])
}
```

---

### Issues

#### #158 — Schema + migration Budget

**O que fazer:**
- Adicionar model `Budget` no schema
- Adicionar relação `budgets Budget[]` no `User` e `Category`
- Rodar `prisma migrate dev`

**Arquivos:** `prisma/schema.prisma`

---

#### #159 — API `/api/budget`

**O que fazer:**
- `GET /api/budget` → lista todos os budgets do usuário com gasto real do mês atual
  ```ts
  // Response:
  { budgets: { id, category: { name, color }, monthlyLimit, currentSpend, percentUsed }[] }
  ```
  - `currentSpend` = soma de transactions EXPENSE da categoria no mês corrente
- `POST /api/budget` → cria ou atualiza (upsert por userId+categoryId)
  ```ts
  { categoryId: string, monthlyLimit: number }
  ```
- `DELETE /api/budget/[id]` → remove orçamento

**Arquivos:** `src/app/api/budget/route.ts`, `src/app/api/budget/[id]/route.ts`

---

#### #160 — `BudgetManager` no Settings

**O que fazer:**
- Criar `src/components/settings/BudgetManager.tsx`
  - Lista categorias com campo de limite mensal editável
  - Toggle para ativar/desativar orçamento por categoria
  - Salva via PATCH `/api/budget`
- Adicionar aba "Orçamentos" na `SettingsPage.tsx`

**Arquivos:** novo `src/components/settings/BudgetManager.tsx`, `src/components/settings/SettingsPage.tsx`

---

#### #161 — `BudgetOverview` no Dashboard

**O que fazer:**
- Criar `src/components/dashboard/BudgetOverview.tsx`
  - Fetch `GET /api/budget`
  - Mostra barras de progresso por categoria (gasto vs limite)
  - Cor: verde < 80%, laranja 80–100%, vermelho > 100%
  - Mostrar apenas categorias com limite definido (máx 5 no dashboard)
- Adicionar abaixo de `RecentTransactions` no dashboard

**Arquivos:** novo `src/components/dashboard/BudgetOverview.tsx`, `src/app/(dashboard)/dashboard/page.tsx`

---

#### #162 — Alerta de Budget + Patrimônio

**Motivação:** Quando gasto ultrapassar 80% do limite → criar notificação. Quando patrimônio cair abaixo de meta → criar notificação.

**O que fazer:**
- Middleware de alerta em `POST /api/transactions`:
  ```ts
  // Após criar transação EXPENSE:
  // 1. Verificar se categoria tem budget
  // 2. Calcular % gasta no mês
  // 3. Verificar se já existe Notification tipo BUDGET_ALERT para
  //    userId + categoryId no mês corrente (dedup obrigatório)
  // 4. Se >= 80% e sem notificação existente → criar Notification
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const existing = await prisma.notification.findFirst({
    where: { userId, type: "BUDGET_ALERT", createdAt: { gte: startOfMonth },
             message: { contains: category.name } }
  });
  if (!existing) { /* criar notificação */ }
  ```
- Alerta de patrimônio em `PATCH /api/patrimonio/target`:
  ```ts
  // Se patrimônio atual < meta * 0.9 → criar Notification tipo BUDGET_ALERT
  ```
- **Dependência:** esta issue referencia `/api/patrimonio/target` que só existe após #154 ser concluída

**Arquivos:** `src/app/api/transactions/route.ts`, `src/app/api/patrimonio/target/route.ts`

---

#### #163 — Export CSV de Transações

**Motivação:** Backup simples, também permite analisar em Excel.

**O que fazer:**
- `GET /api/transactions/export?start=&end=&format=csv`
  - Retorna CSV com: data, descrição, categoria, tipo, valor
  - `Content-Type: text/csv`, `Content-Disposition: attachment; filename="transacoes.csv"`
- Botão "Exportar CSV" em `TransactionList.tsx` (ícone de download)

**Arquivos:** `src/app/api/transactions/export/route.ts`, `src/components/transactions/TransactionList.tsx`

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Foundation | #158 (schema), #159 (API) |
| 2 — UI | #160 (BudgetManager), #161 (BudgetOverview) |
| 3 — Integração | #162 (alertas), #163 (export) |

---

## Milestone v2.4 — Performance & UX

**Objetivo:** Preparar o app para crescer. Paginação, queries eficientes, cache correto, error boundaries.

**Duração estimada:** 1–2 semanas

---

### Issues

#### #164 — Paginação cursor-based em Transações

**Motivação:** `take: 200` hardcoded. Com 10k transações, a listagem fica lenta e carrega dados desnecessários.

**O que fazer:**
- `GET /api/transactions?cursor=&limit=50` — paginação cursor-based (pelo campo `id` ou `date`)
  ```ts
  // Response:
  { transactions: [], nextCursor: string | null, total: number }
  ```
- `TransactionList.tsx` — botão "Carregar mais" ou scroll infinito
- Manter filtros (tipo, categoria, mês) funcionando com paginação

**Arquivos:** `src/app/api/transactions/route.ts`, `src/components/transactions/TransactionList.tsx`

---

#### #165 — Otimizar queries all-time dos Reports

**Motivação:** `/api/reports/networth` e `/api/reports/overview` carregam todas as transações em memória antes de filtrar/agrupar.

**O que fazer:**

`/api/reports/networth`:
```ts
// Antes: findMany all-time + loop em memória
// Depois: $queryRaw com DATE_TRUNC para agrupar por mês no banco
const rows = await prisma.$queryRaw<{ month: Date; type: string; total: number }[]>`
  SELECT DATE_TRUNC('month', date) AS month, type, SUM(amount::numeric) AS total
  FROM "Transaction"
  WHERE "userId" = ${userId}
  GROUP BY DATE_TRUNC('month', date), type
  ORDER BY month ASC
`;
// Prisma groupBy não suporta DATE_TRUNC — usar $queryRaw é obrigatório aqui
```

`/api/reports/overview`:
```ts
// Antes: findMany({ where: { userId } }) all-time
// Depois: dois fetches separados (filtered + aggregated)
const [periodData, allTimeCount] = await Promise.all([
  prisma.transaction.findMany({ where: { userId, date: { gte: start, lte: end } } }),
  prisma.transaction.count({ where: { userId } }),
]);
```

**Arquivos:** `src/app/api/reports/networth/route.ts`, `src/app/api/reports/overview/route.ts`

---

#### #166 — Cache isolado por usuário

**Motivação:** `MemCache` em `src/lib/cache.ts` é global — chave `quotes:PETR4` serve para todos os usuários. Bug potencial.

**O que fazer:**
- Modificar `cached(key, ttlMs, fetcher)` para aceitar prefixo de usuário opcional
- Para cotações (brapi, CoinGecko) o cache é por ticker (não por usuário) — manter global
- Para health snapshot, networth: prefixar chave com `userId`
  ```ts
  cached(`${userId}:health`, 5 * 60_000, () => getHealthSnapshot(userId))
  ```

**Arquivos:** `src/lib/cache.ts`, `src/lib/healthSnapshot.ts`, rotas que usam `cached()`

---

#### #167 — Error Boundaries nos Shells

**Motivação:** Se um componente de gráfico quebrar (ex: Chart.js bug), derruba a página inteira.

**O que fazer:**
- Criar `src/components/shared/ErrorBoundary.tsx` (class component React)
  ```tsx
  // Exibe: "Não foi possível carregar este componente" + botão reload
  ```
- Envolver cada shell de gráfico com `<ErrorBoundary>`
  - `MonthlyChart`, `SpendingDonut`, `NetWorthChart`, `FireProjectionChart`, `PortfolioPerformanceChart`

**Arquivos:** novo `src/components/shared/ErrorBoundary.tsx`, componentes de gráfico

---

#### #168 — SWR para InvestmentsShell

**Motivação:** Trocar aba 3x = 3 fetches para `/api/investments/portfolio`. Sem deduplicação.

**O que fazer:**
- Instalar `swr`: `npm install swr`
- Substituir `useEffect + fetch` em `InvestmentsShell.tsx` por `useSWR` para o endpoint principal `/api/investments/portfolio`:
  ```ts
  const { data: portfolio, isLoading } = useSWR("/api/investments/portfolio", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000, // 1 min
  });
  ```
- Em `PatrimonioShell.tsx`: aplicar SWR **apenas** para `/api/patrimonio/items` (endpoint mais acessado ao trocar abas). Os demais 4 fetches do shell (`networth`, `portfolio`, `fire-essentials`, `categories`) permanecem em `useEffect` — PatrimonioShell tem 5 fetches paralelos e refatorar todos nesta milestone seria escopo grande demais

**Arquivos:** `src/components/investments/InvestmentsShell.tsx`, `src/components/patrimonio/PatrimonioShell.tsx`

**Critério de aceite:** Trocar aba 5x em InvestmentsShell = 1 request nos primeiros 60s; loader funciona corretamente

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Banco | #164 (paginação), #165 (queries) |
| 2 — Cache | #166 (cache por usuário), #168 (SWR) |
| 3 — UX | #167 (error boundaries) |

---

## Milestone v2.5 — Notificações por Email & Export

**Objetivo:** Resend já está configurado no projeto — aproveitar para notificações reais por email + relatório mensal automático + export PDF.

**Duração estimada:** 1–2 semanas

---

### Issues

#### #169 — Email de alerta de budget

**Motivação:** Notificação in-app é ignorável. Email garante que o usuário veja.

**O que fazer:**
- Em `src/lib/email.ts` adicionar template `budgetAlertEmail(category, percentUsed, limit, current)`
- Quando criar `Notification` do tipo `BUDGET_ALERT` (issue #162), também chamar `sendEmail()`
- Respeitar `notifBudgetAlerts` do usuário (já existe no schema)

**Arquivos:** `src/lib/email.ts`, `src/app/api/transactions/route.ts`

---

#### #170 — Relatório mensal automático por email

**Motivação:** `notifMonthlyReport` já existe no schema mas não faz nada.

**O que fazer:**
- `POST /api/cron/monthly-report` — rota protegida por `CRON_SECRET` header
  - Busca todos os usuários com `notifMonthlyReport: true`
  - Para cada usuário: calcula KPIs do mês anterior (income, expense, savings rate, top 3 categorias)
  - Envia email via Resend usando template HTML
- Configurar no Vercel como cron job: `vercel.json`
  ```json
  { "crons": [{ "path": "/api/cron/monthly-report", "schedule": "0 8 1 * *" }] }
  ```

**Arquivos:** `src/app/api/cron/monthly-report/route.ts`, `src/lib/email.ts`, `vercel.json`

---

#### #171 — Export PDF do relatório

**Motivação:** Usuário quer guardar relatório mensal em PDF.

**O que fazer:**
- Instalar `@react-pdf/renderer`
- `GET /api/reports/export?start=&end=&format=pdf`
  - Gera PDF com: health score, KPIs, top categorias, net worth do período
- Botão "Exportar PDF" em `ReportsShell.tsx`

**Arquivos:** `src/app/api/reports/export/route.ts`, `src/components/reports/ReportsShell.tsx`, novo `src/lib/pdf.ts`

---

#### #172 — Reconciliação no Import (dedup)

**Motivação:** Importar o mesmo extrato duas vezes cria duplicatas. Usuário não tem como saber.

**O que fazer:**
- A detecção de duplicatas deve ficar em `POST /api/import/confirm` (tem acesso ao banco). O parse (`/api/import/parse`) apenas estrutura os dados brutos — não acessa Prisma.
- Em `POST /api/import/confirm`, antes do `createMany`:
  - Para cada linha, buscar transação existente com mesma `date + amount` exatos
  - Comparar `description` com ~85% de similaridade (usar Levenshtein simples ou `includes` normalizado)
  - Retornar preview enriquecido com `isDuplicate: true` para linhas suspeitas
- Em `ImportPreviewTable.tsx`:
  - Linha duplicada recebe badge "Duplicata" + checkbox desmarcado por default
  - Usuário pode forçar importar se quiser

**Arquivos:** `src/app/api/import/confirm/route.ts`, `src/components/import/ImportPreviewTable.tsx`

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Email | #169 (budget alert), #170 (monthly report) |
| 2 — Export | #171 (PDF), #163 já feito (CSV) |
| 3 — Import | #172 (dedup) |

---

## Milestone v2.6 — Investimentos Evoluídos

**Objetivo:** Investimentos hoje rastreiam carteira e proventos, mas não calculam base de custo real nem mostram rendimento de renda fixa corretamente.

**Duração estimada:** 2 semanas

---

### Issues

#### #173 — Cost Basis Tracking (FIFO simples)

**Motivação:** App mostra P&L por preço atual vs `avgCost`, mas `avgCost` é editado manualmente. Deveria ser calculado a partir das entradas.

**O que fazer:**
- Novo campo em `Asset`: `costBasis Decimal? @db.Decimal(14,2)` — calculado, não editado
- Ao fazer `POST /api/investments/entries` com tipo `BUY`:
  - Recalcular `avgCost` e `costBasis` do ativo com FIFO simples
    ```ts
    costBasis = sum(entry.price * entry.quantity) para todas as entradas BUY não liquidadas
    avgCost = costBasis / totalQuantity
    ```
- Na carteira: mostrar `costBasis` vs `currentValue` como P&L mais preciso

**Arquivos:** `prisma/schema.prisma`, `src/app/api/investments/entries/route.ts`, `src/app/api/investments/portfolio/route.ts`

---

#### #174 — Dividend Calendar

**Motivação:** Usuário com ações que pagam dividendos não sabe quando o próximo pagamento acontece.

**O que fazer:**
- **Distinção importante:** `InvestmentEntry` com `type = DIVIDEND` representa dividendos **já recebidos e registrados** pelo usuário. O novo `DividendEvent` representa dividendos **futuros/esperados** (ex: data ex-dividendo anunciada pela empresa). São dois conceitos complementares, não duplicados.
- Novo model `DividendEvent`:
  ```prisma
  model DividendEvent {
    id        String   @id @default(cuid())
    userId    String
    assetId   String
    exDate    DateTime  // data ex-dividendo
    payDate   DateTime  // data de pagamento
    amountPerShare Decimal @db.Decimal(10, 4)
    status    DividendStatus @default(EXPECTED)
    createdAt DateTime @default(now())
  }
  enum DividendStatus { EXPECTED CONFIRMED PAID }
  // EXPECTED = anunciado, CONFIRMED = aprovado em assembleia, PAID = creditado (vira InvestmentEntry)
  ```
- `GET /api/investments/dividends/calendar?months=3` → próximos dividendos esperados
- `DividendCalendar.tsx` na aba Proventos — lista dos próximos 3 meses

**Arquivos:** `prisma/schema.prisma`, `src/app/api/investments/dividends/calendar/route.ts`, `src/components/investments/DividendCalendar.tsx`

---

#### #175 — Relatório Simplificado de IR

**Motivação:** Pessoa física precisa declarar ganho de capital em venda de ações. App tem todas as entradas, mas não agrega para IR.

**O que fazer:**
- `GET /api/investments/tax-report?year=2025`
  ```ts
  // Response por ativo:
  { asset, totalBought, totalSold, realizedGain, darf: boolean }
  // darf: true se ganho > R$ 20.000 no mês (isenção para ações)
  ```
- `TaxReport.tsx` na aba Carteira — tabela por ativo com ganho/perda realizado
- Botão "Exportar para IR" → CSV no formato exigido

**Arquivos:** `src/app/api/investments/tax-report/route.ts`, `src/components/investments/TaxReport.tsx`

---

#### #176 — Rendimento Real de Renda Fixa

**Motivação:** `v2.1` adicionou `indexer` e `rate` mas o rendimento mostrado (`monthlyYield`) é estimado. Não considera CDI/IPCA real.

**O que fazer:**
- A função `calcMonthlyYield()` já existe em `src/app/api/investments/portfolio/route.ts` e usa `selicAnual` com fallback hardcoded de 10.5%. Esta issue é um **refinamento** dessa função para usar CDI/IPCA real via `fetchBenchmarks()`:
  ```ts
  // Estender calcMonthlyYield() existente:
  const { cdi, ipca } = await fetchBenchmarks(); // cache 1h em src/lib/benchmarks.ts

  // Se indexer === "CDI":
  // CDI diário = (1 + cdi/100)^(1/252) - 1
  const cdiDiario = (1 + cdi / 100) ** (1 / 252) - 1;
  monthlyYield = asset.value * ((1 + cdiDiario) ** 22 - 1) * (asset.rate / 100);

  // Se indexer === "IPCA":
  const ipcaMensal = (1 + ipca / 100) ** (1 / 12) - 1;
  monthlyYield = asset.value * (ipcaMensal + asset.rate / 100 / 12);
  ```
  **Nota:** `^` em TypeScript é XOR bit a bit — usar sempre `**` para exponenciação.
- Usar `fetchBenchmarks()` já existente em `src/lib/benchmarks.ts` (CDI/IPCA em cache 1h)

**Arquivos:** `src/app/api/investments/portfolio/route.ts`, `src/lib/benchmarks.ts`

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Foundation | #173 (cost basis schema), #174 (dividend calendar schema) |
| 2 — API | #175 (tax report API), #176 (rendimento real) |
| 3 — UI | #174 (DividendCalendar UI), #175 (TaxReport UI) |

---

## Milestone v2.7 — Journal & Forecast

**Objetivo:** Journal está funcional mas sem busca. Forecast de gastos é a feature analítica de maior valor que ainda falta.

**Duração estimada:** 1–2 semanas

---

### Issues

#### #177 — Busca e Filtro Avançado no Journal

**Motivação:** Com muitas entradas, o usuário não consegue encontrar o que precisa.

**O que fazer:**
- `GET /api/journal?q=&tag=&type=&month=&healthMin=&healthMax=` — expandir filtros existentes
  - Adicionar busca fulltext em `title` e `content` (ILIKE)
  - Filtro por tag (array contains)
  - Filtro por health score range
- `JournalList.tsx` — adicionar campo de busca + filtro de health score range
- `JournalEntryCard.tsx` — highlight de termo buscado no preview

**Arquivos:** `src/app/api/journal/route.ts`, `src/components/journal/JournalList.tsx`, `src/components/journal/JournalEntryCard.tsx`

---

#### #178 — Forecast de Gastos

**Motivação:** Usuário quer saber como o mês vai fechar antes de acabar. Hoje só tem SpendingVelocityCard (projeção simples de fim de mês).

**O que fazer:**
- `GET /api/reports/forecast?months=3`
  ```ts
  // Se usuário tem < 3 meses de histórico → retornar hasEnoughData: false (mesmo padrão de /api/reports/seasonal)
  // Se >= 3 meses: usa média ponderada dos últimos 6 meses (peso maior para os mais recentes)
  // Por categoria: projected_spend = weighted_avg * adjustment_factor
  // Response:
  { hasEnoughData: boolean, months: [{ month, projectedIncome, projectedExpense, projectedBalance }] }
  ```
- `ForecastChart.tsx` em Reports > Fluxo de Caixa
  - Linha sólida = histórico real
  - Linha tracejada = projeção nos próximos 3 meses
  - Cor diferente para período projetado

**Arquivos:** `src/app/api/reports/forecast/route.ts`, `src/components/reports/fluxo-caixa/ForecastChart.tsx`, `src/components/reports/ReportsShell.tsx`

---

#### #179 — Budget vs Actual nos Reports

**Motivação:** Budget foi criado na v2.3, mas sem visualização comparativa no relatório.

**O que fazer:**
- `GET /api/reports/budget-actual?start=&end=`
  ```ts
  // Por categoria com budget definido:
  { category, budgeted, actual, variance, months: [{ month, budgeted, actual }] }
  ```
- `BudgetActualChart.tsx` em Reports — nova aba "Orçamento"
  - Grouped bar (budget vs actual por categoria)
  - Tabela com variância e % de desvio

**Arquivos:** `src/app/api/reports/budget-actual/route.ts`, novo `src/components/reports/orcamento/BudgetActualChart.tsx`, `src/components/reports/ReportsShell.tsx`

---

#### #180 — Decision Tracking no Journal

**Motivação:** Usuário registra uma decisão financeira ("vou parar de gastar com X"), mas não há follow-up.

**O que fazer:**
- Novo `entryType`: `DECISAO` no enum `EntryType`
- Campo `followUpDate DateTime?` no model `JournalEntry`
- Notificação automática na data de follow-up: "Você decidiu X em [data]. Como está indo?"
- Badge especial em `JournalEntryCard` para entradas com follow-up pendente

**Arquivos:** `prisma/schema.prisma`, `src/app/api/journal/route.ts`, `src/components/journal/JournalEditor.tsx`, `src/components/journal/JournalEntryCard.tsx`

---

### Fase da milestone

| Fase | Issues |
|------|--------|
| 1 — Journal | #177 (busca), #180 (decision tracking) |
| 2 — Forecast | #178 (forecast API + chart) |
| 3 — Reports | #179 (budget vs actual) |

---

## Resumo do Roadmap

| Milestone | Tema | Issues | Estimativa |
|-----------|------|--------|------------|
| **v2.2** | Consolidação Técnica | #152–#157 | 1 semana |
| **v2.3** | Budget & Alertas | #158–#163 | 1–2 semanas |
| **v2.4** | Performance & UX | #164–#168 | 1–2 semanas |
| **v2.5** | Notificações & Export | #169–#172 | 1–2 semanas |
| **v2.6** | Investimentos Evoluídos | #173–#176 | 2 semanas |
| **v2.7** | Journal & Forecast | #177–#180 | 1–2 semanas |

**Total:** 29 issues / ~8–11 semanas de desenvolvimento solo

---

## Padrões que se mantêm (não mudar)

- Autenticação: sempre `const session = await auth(); if (!session?.user?.id) return 401`
- Serialização: Decimal → number via `toNumber()` (novo helper), Date → `.toISOString()`
- Gráficos: sempre `"use client"` + `mounted` guard + `animation: { duration: 1000, easing: "easeOutQuart" }`
- Cores: sempre tokens `axiom-*`, nunca hex hardcoded
- Estado local: após mutação, atualizar array local (sem refetch)
- Build: `npm run build` antes de qualquer commit

---

> Atualizado em 2026-04-25 — revisão crítica aplicada (paths, groupBy, CDI formula, notif dedup, SWR scope, DividendEvent distinção, Forecast fallback)
> Próxima milestone a executar: **v2.2 Consolidação Técnica**

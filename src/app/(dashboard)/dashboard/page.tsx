export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import { KPICard } from "@/components/dashboard/KPICard";
import { MonthlyChart } from "@/components/dashboard/MonthlyChart";
import { SpendingDonut } from "@/components/dashboard/SpendingDonut";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { BudgetOverview } from "@/components/dashboard/BudgetOverview";
import { DashboardInsights, InsightCard } from "@/components/dashboard/DashboardInsights";
import { PortfolioRotatingCard } from "@/components/dashboard/PortfolioRotatingCard";
import { PeriodFilter } from "@/components/shared/PeriodFilter";
import { formatCurrency } from "@/lib/utils";
import { Wallet, ArrowUpRight, ArrowDownRight, Scale, Coins, TrendingUp, TrendingDown } from "lucide-react";
import type { DashboardInsight } from "@/components/dashboard/DashboardInsights";

const ASSET_TYPE_LABELS: Record<string, string> = {
  STOCK: "Ações BR", FII: "Fundos Imobiliários", ETF: "ETFs",
  BDR: "BDRs", CRYPTO: "Cripto", FIXED_INCOME: "Renda Fixa",
  STOCK_INT: "Ações Internacionais", OTHER: "Outros",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toNumber(val: any): number {
  return parseFloat(String(val));
}

function parsePeriod(
  tipo: string,
  valor: string,
  de: string,
  ate: string
): { start: Date; end: Date } {
  const now = new Date();

  if (tipo === "dia" && valor) {
    return {
      start: new Date(`${valor}T00:00:00`),
      end: new Date(`${valor}T23:59:59.999`),
    };
  }

  if (tipo === "ano" && valor) {
    const year = parseInt(valor);
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  if (tipo === "periodo" && de && ate) {
    return {
      start: new Date(`${de}T00:00:00`),
      end: new Date(`${ate}T23:59:59.999`),
    };
  }

  // mes (default)
  if (valor) {
    const [year, month] = valor.split("-").map(Number);
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 0, 23, 59, 59, 999),
    };
  }

  // fallback: mês atual
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

async function getDashboardData(
  userId: string,
  locale: string,
  start: Date,
  end: Date
) {
  // Período anterior com a mesma duração
  const duration = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - duration - 1);
  const prevEnd = new Date(start.getTime() - 1);

  const [allTransactions, periodTx, prevTx, recentTx, categoryTx, defaultCurrency, dividendEntries, portfolioAssets] =
    await Promise.all([
      // All-time para saldo total
      prisma.transaction.findMany({ where: { userId } }),
      // Período selecionado
      prisma.transaction.findMany({
        where: { userId, date: { gte: start, lte: end } },
      }),
      // Período anterior (para comparação)
      prisma.transaction.findMany({
        where: { userId, date: { gte: prevStart, lte: prevEnd } },
      }),
      // Últimas 6 transações (recentes absolutas, não filtradas por período)
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 6,
        include: { category: true },
      }),
      // Despesas do período por categoria (para o donut)
      prisma.transaction.findMany({
        where: { userId, type: "EXPENSE", date: { gte: start, lte: end } },
        include: { category: true },
      }),
      // Moeda padrão
      prisma.userCurrency.findFirst({
        where: { userId, isDefault: true },
      }),
      // Proventos all-time (não filtrado por período)
      prisma.investmentEntry.findMany({
        where: { userId, type: "DIVIDEND" },
      }),
      // Ativos com entradas para calcular P&L da carteira
      prisma.asset.findMany({
        where: { userId },
        include: { entries: { orderBy: { date: "asc" } } },
      }),
    ]);

  // KPIs do período
  const totalBalance = allTransactions.reduce((acc, tx) => {
    return tx.type === "INCOME"
      ? acc + toNumber(tx.amount)
      : acc - toNumber(tx.amount);
  }, 0);

  const income = periodTx
    .filter((t) => t.type === "INCOME")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);

  const expenses = periodTx
    .filter((t) => t.type === "EXPENSE")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);

  const netDifference = income - expenses;

  // Comparações com período anterior
  const prevIncome = prevTx
    .filter((t) => t.type === "INCOME")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);
  const prevExpenses = prevTx
    .filter((t) => t.type === "EXPENSE")
    .reduce((acc, t) => acc + toNumber(t.amount), 0);
  const prevNet = prevIncome - prevExpenses;

  const incomeChange = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : 0;
  const expensesChange = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : 0;
  const netDiffChange = prevNet !== 0 ? ((netDifference - prevNet) / Math.abs(prevNet)) * 100 : 0;

  // MonthlyChart: todos os meses do período selecionado
  const monthCount =
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() - start.getMonth() + 1;
  const spanYears = end.getFullYear() !== start.getFullYear();

  const monthlyData = Array.from({ length: monthCount }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthTx = allTransactions.filter((t) => t.date >= d && t.date <= mEnd);
    return {
      month: d.toLocaleString(locale, {
        month: "short",
        ...(spanYears ? { year: "2-digit" } : {}),
      }),
      income: monthTx
        .filter((t) => t.type === "INCOME")
        .reduce((acc, t) => acc + toNumber(t.amount), 0),
      expenses: monthTx
        .filter((t) => t.type === "EXPENSE")
        .reduce((acc, t) => acc + toNumber(t.amount), 0),
    };
  });

  // Donut: despesas por categoria no período
  const categoryMap = new Map<string, { name: string; value: number; color: string }>();
  for (const tx of categoryTx) {
    const key = tx.category.name;
    const existing = categoryMap.get(key);
    if (existing) {
      existing.value += toNumber(tx.amount);
    } else {
      categoryMap.set(key, {
        name: tx.category.name,
        value: toNumber(tx.amount),
        color: tx.category.color,
      });
    }
  }
  const categorySpending = Array.from(categoryMap.values()).sort(
    (a, b) => b.value - a.value
  );

  const currency = defaultCurrency?.code ?? "BRL";

  // Proventos do período
  const periodDividends = dividendEntries.reduce((acc, e) => acc + toNumber(e.amount), 0);

  // P&L da carteira + alocação por tipo (all-time)
  let portfolioTotalInvested = 0;
  let portfolioCurrentValue = 0;
  let hasPriceData = false;
  const allocationMap: Record<string, number> = {};
  for (const asset of portfolioAssets) {
    let qty = 0, cost = 0;
    for (const e of asset.entries) {
      const q = toNumber(e.quantity), p = toNumber(e.price);
      if (e.type === "PURCHASE") { cost += q * p; qty += q; }
      else if (e.type === "SALE" && qty > 0) { cost -= q * (cost / qty); qty -= q; }
      else if (e.type === "SPLIT") { qty = q; }
    }
    if (qty < 0.000001) qty = 0;
    const avgCost = qty > 0 ? cost / qty : 0;
    const hasPrice = !!asset.currentPrice && toNumber(asset.currentPrice) > 0;
    if (hasPrice) hasPriceData = true;
    const currentPrice = hasPrice ? toNumber(asset.currentPrice!) : avgCost;
    const val = qty * currentPrice;
    portfolioTotalInvested += qty * avgCost;
    portfolioCurrentValue += val;
    if (qty > 0) allocationMap[asset.type] = (allocationMap[asset.type] ?? 0) + val;
  }
  const portfolioPnl = portfolioCurrentValue - portfolioTotalInvested;
  const portfolioPnlPct = portfolioTotalInvested > 0 ? (portfolioPnl / portfolioTotalInvested) * 100 : 0;
  const allTimeDividends = dividendEntries.reduce((acc, e) => acc + toNumber(e.amount), 0);

  return {
    totalBalance,
    income,
    expenses,
    netDifference,
    incomeChange,
    expensesChange,
    netDiffChange,
    monthlyData,
    categorySpending,
    currency,
    allTimeDividends,
    hasPriceData,
    portfolioTotalInvested,
    portfolioCurrentValue,
    portfolioPnl,
    portfolioPnlPct,
    allocationByType: allocationMap,
    recentTransactions: recentTx.map((tx) => ({
      id: tx.id,
      description: tx.description,
      amount: toNumber(tx.amount),
      type: tx.type,
      date: tx.date,
      category: { name: tx.category.name, color: tx.category.color },
    })),
  };
}

function generateInsights(params: {
  income: number;
  expenses: number;
  netDifference: number;
  incomeChange: number;
  expensesChange: number;
  categorySpending: { name: string; value: number }[];
  currency: string;
  locale: string;
}): DashboardInsight[] {
  const { income, expenses, netDifference, incomeChange, expensesChange, categorySpending, currency, locale } = params;
  if (income === 0 && expenses === 0) return [];

  const insights: DashboardInsight[] = [];

  // Expenses vs previous period
  if (expensesChange > 15) {
    insights.push({
      type: "warning",
      title: "Alerta de Gastos",
      message: `Seus gastos aumentaram ${expensesChange.toFixed(0)}% em relação ao período anterior.`,
    });
  } else if (expensesChange < -10) {
    insights.push({
      type: "positive",
      title: "Economia nos Gastos",
      message: `Seus gastos reduziram ${Math.abs(expensesChange).toFixed(0)}% em relação ao período anterior.`,
    });
  }

  // Income vs previous period
  if (incomeChange > 5) {
    insights.push({
      type: "positive",
      title: "Receita em Alta",
      message: `Sua receita cresceu ${incomeChange.toFixed(1)}% em relação ao período anterior.`,
    });
  } else if (incomeChange < -10) {
    insights.push({
      type: "negative",
      title: "Queda na Receita",
      message: `Sua receita caiu ${Math.abs(incomeChange).toFixed(1)}% em relação ao período anterior.`,
    });
  }

  // Top spending category
  if (categorySpending.length > 0 && expenses > 0) {
    const top = categorySpending[0];
    const pct = (top.value / expenses) * 100;
    if (pct > 30) {
      insights.push({
        type: "neutral",
        title: top.name,
        message: `Representa ${pct.toFixed(0)}% dos seus gastos — ${formatCurrency(top.value, locale, currency)}.`,
      });
    }
  }

  // Net savings insight
  if (netDifference > 0 && income > 0) {
    const savingsRate = (netDifference / income) * 100;
    if (savingsRate >= 20) {
      insights.push({
        type: "success",
        title: "Meta de Poupança",
        message: `Você poupou ${savingsRate.toFixed(0)}% da receita. Continue assim!`,
      });
    } else {
      insights.push({
        type: "success",
        title: "Saldo Positivo",
        message: `Sobrou ${formatCurrency(netDifference, locale, currency)} no período. Bom trabalho!`,
      });
    }
  } else if (netDifference < 0 && income > 0) {
    insights.push({
      type: "warning",
      title: "Gastos Acima da Receita",
      message: `Seus gastos superaram a receita em ${formatCurrency(Math.abs(netDifference), locale, currency)}.`,
    });
  }

  return insights.slice(0, 4);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; valor?: string; de?: string; ate?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [locale, t, sp] = await Promise.all([
    getLocale(),
    getTranslations("Dashboard"),
    searchParams,
  ]);

  const { start, end } = parsePeriod(
    sp.tipo ?? "mes",
    sp.valor ?? "",
    sp.de ?? "",
    sp.ate ?? ""
  );

  const data = await getDashboardData(session.user.id, locale, start, end);

  const insights = generateInsights({
    income: data.income,
    expenses: data.expenses,
    netDifference: data.netDifference,
    incomeChange: data.incomeChange,
    expensesChange: data.expensesChange,
    categorySpending: data.categorySpending,
    currency: data.currency,
    locale,
  });

  return (
    <div className="space-y-6">
      {/* Filtro de período */}
      <PeriodFilter />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard
          title={t("totalBalance")}
          value={data.totalBalance}
          icon={<Wallet size={20} />}
          type="neutral"
          locale={locale}
          currency={data.currency}
        />
        <KPICard
          title={t("income")}
          value={data.income}
          change={data.incomeChange}
          icon={<ArrowUpRight size={20} />}
          type="income"
          locale={locale}
          currency={data.currency}
        />
        <KPICard
          title={t("expenses")}
          value={data.expenses}
          change={data.expensesChange}
          icon={<ArrowDownRight size={20} />}
          type="expense"
          locale={locale}
          currency={data.currency}
        />
        <KPICard
          title={t("netDifference")}
          value={data.netDifference}
          change={data.netDiffChange}
          icon={<Scale size={20} />}
          type={data.netDifference >= 0 ? "income" : "expense"}
          locale={locale}
          currency={data.currency}
        />
      </div>

      {/* Unified insights row: investment cards + behavioral insights side by side */}
      {(() => {
        const pnlPositive = data.portfolioPnl >= 0;
        const allocations = Object.entries(data.allocationByType)
          .sort(([, a], [, b]) => b - a)
          .map(([type, val]) => ({
            type,
            label: ASSET_TYPE_LABELS[type] ?? type,
            pct: data.portfolioCurrentValue > 0 ? (val / data.portfolioCurrentValue) * 100 : 0,
            value: val,
          }));
        const hasInvestments = data.allTimeDividends > 0 || data.portfolioTotalInvested > 0;
        const hasInsights = insights.length > 0;
        if (!hasInvestments && !hasInsights) return null;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {/* Portfolio P&L — só mostra se tem preço de mercado configurado */}
            {data.portfolioTotalInvested > 0 && data.hasPriceData && (
              <div className={`bg-axiom-card border ${pnlPositive ? "border-axiom-income/30" : "border-axiom-expense/30"} rounded-xl p-4 flex flex-col gap-2`}>
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg ${pnlPositive ? "bg-axiom-income/10" : "bg-axiom-expense/10"} flex items-center justify-center shrink-0`}>
                    {pnlPositive ? <TrendingUp size={14} className="text-axiom-income" /> : <TrendingDown size={14} className="text-axiom-expense" />}
                  </div>
                  <p className={`text-sm font-semibold ${pnlPositive ? "text-axiom-income" : "text-axiom-expense"}`}>
                    {pnlPositive ? "Carteira Valorizada" : "Carteira Desvalorizada"}
                  </p>
                </div>
                <p className="text-axiom-muted text-xs leading-relaxed">
                  {pnlPositive ? "+" : ""}{formatCurrency(data.portfolioPnl, locale, data.currency)} ({data.portfolioPnlPct.toFixed(2)}%) desde o início.
                </p>
              </div>
            )}
            {/* Total investido — quando não há preços de mercado configurados */}
            {data.portfolioTotalInvested > 0 && !data.hasPriceData && (
              <div className="bg-axiom-card border border-axiom-border rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-axiom-hover flex items-center justify-center shrink-0">
                    <TrendingUp size={14} className="text-axiom-muted" />
                  </div>
                  <p className="text-sm font-semibold text-axiom-muted">Total Investido</p>
                </div>
                <p className="text-axiom-muted text-xs leading-relaxed">
                  {formatCurrency(data.portfolioTotalInvested, locale, data.currency)} aportados. Adicione o preço atual dos ativos para ver o P&L.
                </p>
              </div>
            )}
            {/* Dividends all-time */}
            {data.allTimeDividends > 0 && (
              <div className="bg-axiom-card border border-axiom-income/30 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-axiom-income/10 flex items-center justify-center shrink-0">
                    <Coins size={14} className="text-axiom-income" />
                  </div>
                  <p className="text-sm font-semibold text-axiom-income">Proventos Recebidos</p>
                </div>
                <p className="text-axiom-muted text-xs leading-relaxed">
                  {formatCurrency(data.allTimeDividends, locale, data.currency)} em dividendos acumulados.
                </p>
              </div>
            )}
            {/* Rotating allocation */}
            {allocations.length > 0 && (
              <PortfolioRotatingCard allocations={allocations} currency={data.currency} locale={locale} />
            )}
            {/* Behavioral insights */}
            {insights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
          </div>
        );
      })()}

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="xl:col-span-2">
          <MonthlyChart data={data.monthlyData} currency={data.currency} />
        </div>
        <SpendingDonut data={data.categorySpending} currency={data.currency} />
      </div>

      {/* Recent Transactions */}
      <RecentTransactions transactions={data.recentTransactions} currency={data.currency} />

      {/* Budget Overview */}
      <BudgetOverview />
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { PatrimonioEvolutionChart } from "./PatrimonioEvolutionChart";
import { SavingsRateChart } from "@/components/reports/patrimonio/SavingsRateChart";
import { AssetBreakdown } from "./AssetBreakdown";
import { PortfolioPerformanceChart } from "./PortfolioPerformanceChart";
import { WealthItems } from "./WealthItems";
import { GoalsList } from "./GoalsList";
import type { NetworthData } from "@/components/reports/types";
import type { WealthItemsResponse } from "@/types/fire";
import type { FireEssentialsResponse } from "@/types/fire";

type PatrimonioTab = "evolucao" | "analise" | "bens" | "meta";

const TABS: { key: PatrimonioTab; label: string }[] = [
  { key: "evolucao", label: "Evolução" },
  { key: "analise", label: "Análise" },
  { key: "bens", label: "Bens & Passivos" },
  { key: "meta", label: "Meta" },
];

interface PortfolioTotals {
  totalCurrentValue: number;
}

interface PortfolioForPatrimonio {
  totals: PortfolioTotals;
  allocationByType: Partial<Record<string, number>>;
}

function SkeletonCard({ label }: { label: string }) {
  return (
    <div className="bg-axiom-card border border-axiom-border rounded-xl p-6 flex flex-col gap-4">
      <p className="text-axiom-muted text-sm font-medium">{label}</p>
      <div className="flex-1 animate-pulse bg-axiom-hover rounded-lg h-32" />
    </div>
  );
}

interface PatrimonioShellProps {
  initialCurrency: string;
  initialLocale: string;
}

export function PatrimonioShell({ initialCurrency, initialLocale }: PatrimonioShellProps) {
  const [activeTab, setActiveTab] = useState<PatrimonioTab>("evolucao");

  const [data, setData] = useState<NetworthData | null>(null);
  const [loading, setLoading] = useState(false);

  const [portfolioData, setPortfolioData] = useState<PortfolioForPatrimonio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const [itemsData, setItemsData] = useState<WealthItemsResponse | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [essentialsData, setEssentialsData] = useState<FireEssentialsResponse | null>(null);
  const [userCategories, setUserCategories] = useState<{ id: string; name: string; color: string }[]>([]);

  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setItemsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/patrimonio/items");
      if (res.ok) setItemsData(await res.json());
    } catch {
      setError("Não foi possível carregar os dados.");
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setPortfolioLoading(true);
    setError(null);
    setItemsLoading(true);

    const [networthRes, portfolioRes, itemsRes, essentialsRes, categoriesRes] = await Promise.allSettled([
      fetch("/api/reports/networth"),
      fetch("/api/investments/portfolio"),
      fetch("/api/patrimonio/items"),
      fetch("/api/reports/fire-essentials"),
      fetch("/api/categories"),
    ]);

    if (networthRes.status === "fulfilled" && networthRes.value.ok) {
      setData(await networthRes.value.json());
    }
    setLoading(false);

    if (portfolioRes.status === "fulfilled" && portfolioRes.value.ok) {
      setPortfolioData(await portfolioRes.value.json());
    }
    setPortfolioLoading(false);

    if (itemsRes.status === "fulfilled" && itemsRes.value.ok) {
      setItemsData(await itemsRes.value.json());
    }
    setItemsLoading(false);

    if (essentialsRes.status === "fulfilled" && essentialsRes.value.ok) {
      setEssentialsData(await essentialsRes.value.json());
    }

    if (categoriesRes.status === "fulfilled" && categoriesRes.value.ok) {
      const cats = await categoriesRes.value.json();
      setUserCategories(cats.map((c: { id: string; name: string; color: string }) => ({ id: c.id, name: c.name, color: c.color })));
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const avgMonthlySavings =
    data && data.months.length > 0
      ? data.months.reduce((acc, m) => acc + (m.monthIncome - m.monthExpenses), 0) /
        data.months.length
      : 0;

  const adjustedNetWorth = (data?.currentNetWorth ?? 0) + (itemsData?.net ?? 0);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="text-axiom-expense text-sm p-4">{error}</div>
      )}
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Patrimônio</h1>
        <p className="text-sm text-axiom-muted mt-0.5">
          Evolução do seu patrimônio, taxa de poupança e projeção de independência financeira
        </p>
      </div>

      {/* Tabs */}
      <div className="flex bg-axiom-hover rounded-lg p-1 gap-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-axiom-primary text-white"
                : "text-axiom-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Aba: Evolução */}
      {activeTab === "evolucao" && (
        <div className="grid grid-cols-1 gap-4">
          {loading || !data ? (
            <>
              <SkeletonCard label="Evolução do Patrimônio" />
              <SkeletonCard label="Taxa de Poupança" />
            </>
          ) : (
            <>
              <div style={{ minHeight: 360 }}>
                <PatrimonioEvolutionChart
                  networthData={data}
                  itemsNet={itemsData?.net ?? 0}
                  currency={initialCurrency}
                  locale={initialLocale}
                />
              </div>
              <div style={{ minHeight: 280 }}>
                <SavingsRateChart
                  networthData={data}
                  currency={initialCurrency}
                  locale={initialLocale}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Aba: Análise */}
      {activeTab === "analise" && (
        <div className="grid grid-cols-1 gap-4">
          {portfolioLoading ? (
            <SkeletonCard label="Breakdown por Classe de Ativo" />
          ) : (
            <AssetBreakdown
              allocationByType={portfolioData?.allocationByType ?? {}}
              totalCurrentValue={portfolioData?.totals.totalCurrentValue ?? 0}
              currency={initialCurrency}
              locale={initialLocale}
            />
          )}

          <PortfolioPerformanceChart />
        </div>
      )}

      {/* Aba: Bens & Passivos */}
      {activeTab === "bens" && (
        <>
          {itemsLoading ? (
            <SkeletonCard label="Bens e Passivos" />
          ) : (
            <WealthItems
              items={itemsData?.items ?? []}
              totalAssets={itemsData?.totalAssets ?? 0}
              totalLiabilities={itemsData?.totalLiabilities ?? 0}
              net={itemsData?.net ?? 0}
              currency={initialCurrency}
              locale={initialLocale}
              onRefresh={fetchItems}
              liabilityCosts={essentialsData?.liabilityCosts ?? []}
              userCategories={userCategories}
            />
          )}
        </>
      )}

      {/* Aba: Meta */}
      {activeTab === "meta" && (
        <GoalsList currency={initialCurrency} locale={initialLocale} />
      )}
    </div>
  );
}

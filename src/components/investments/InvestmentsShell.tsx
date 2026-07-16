"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { PortfolioSummaryCards } from "./portfolio/PortfolioSummaryCards";
import { PortfolioDonut } from "./portfolio/PortfolioDonut";
import { AssetList } from "./portfolio/AssetList";
import { EntryList } from "./entries/EntryList";
import { BenchmarkBar } from "./benchmarks/BenchmarkBar";
import { IntelligenceTab } from "./intelligence/IntelligenceTab";
import { ProventosTab } from "./proventos/ProventosTab";
import type { AssetPosition } from "@/app/api/investments/portfolio/route";
import type { AssetType } from "@/generated/prisma/client";
import type { BenchmarkData } from "@/lib/benchmarks";

interface PortfolioData {
  assets: AssetPosition[];
  totals: {
    totalInvested: number;
    totalCurrentValue: number;
    totalPnl: number;
    totalPnlPct: number;
  };
  allocationByType: Partial<Record<AssetType, number>>;
}

interface AssetRaw {
  id: string;
  name: string;
  ticker: string | null;
  type: AssetType;
  currency: string;
  currentPrice: number | null;
  createdAt?: string;
}

interface InvestmentsShellProps {
  initialCurrency: string;
  initialLocale: string;
}

export function InvestmentsShell({ initialCurrency, initialLocale }: InvestmentsShellProps) {
  const t = useTranslations("Investments");
  const [activeTab, setActiveTab] = useState<"portfolio" | "entries" | "proventos" | "intelligence">("entries");
  const [portfolioKey, setPortfolioKey] = useState(0);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [assets, setAssets] = useState<AssetRaw[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkData | null>(null);
  const [benchmarksLoading, setBenchmarksLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const triggerPortfolioRefresh = useCallback(() => setPortfolioKey((k) => k + 1), []);

  function handleTabChange(tab: "entries" | "portfolio" | "proventos" | "intelligence") {
    setActiveTab(tab);
    // Ao entrar na aba Carteira, recarregar para incluir ativos criados inline
    if (tab === "portfolio") triggerPortfolioRefresh();
  }

  function handleNewAsset(asset: AssetRaw) {
    setAssets((prev) => [...prev, asset]);
  }

  const fetchPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    setError(null);
    try {
      const [portfolioRes, assetsRes, benchmarksRes] = await Promise.all([
        fetch("/api/investments/portfolio"),
        fetch("/api/investments/assets"),
        fetch("/api/investments/benchmarks"),
      ]);
      const [portfolio, assetsList, benchmarksData] = await Promise.all([
        portfolioRes.json(),
        assetsRes.json(),
        benchmarksRes.json(),
      ]);
      setPortfolioData(portfolio);
      setAssets(assetsList);
      setBenchmarks(benchmarksData);
    } catch {
      setError("Não foi possível carregar os dados.");
    } finally {
      setPortfolioLoading(false);
      setBenchmarksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio, portfolioKey]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {error && (
        <div className="text-axiom-expense text-sm p-4">{error}</div>
      )}
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-white">{t("title")}</h1>
        <div className="flex bg-axiom-hover rounded-lg p-1 gap-1 w-fit">
        {(["entries", "portfolio", "proventos", "intelligence"] as const).map((key) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key ? "bg-axiom-primary text-white" : "text-axiom-muted hover:text-white"
            }`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
        </div>
      </div>

      <BenchmarkBar data={benchmarks} loading={benchmarksLoading} />

      {activeTab === "portfolio" && (
        <div className="mt-6 flex flex-col gap-6">
          <PortfolioSummaryCards
            totals={portfolioData?.totals ?? null}
            loading={portfolioLoading}
            currency={initialCurrency}
            locale={initialLocale}
          />
          <AssetList
            positions={portfolioData?.assets ?? []}
            loading={portfolioLoading}
            currency={initialCurrency}
            locale={initialLocale}
            onRefresh={triggerPortfolioRefresh}
          />
          {(portfolioData?.assets ?? []).length > 0 && (
            <PortfolioDonut
              allocationByType={portfolioData?.allocationByType ?? {}}
              totalCurrentValue={portfolioData?.totals.totalCurrentValue ?? 0}
              loading={portfolioLoading}
              currency={initialCurrency}
              locale={initialLocale}
            />
          )}
        </div>
      )}

      {activeTab === "entries" && (
        <div className="mt-6">
          <EntryList
            assets={assets}
            currency={initialCurrency}
            locale={initialLocale}
            onEntryCreated={triggerPortfolioRefresh}
            onNewAsset={handleNewAsset}
          />
        </div>
      )}

      {activeTab === "proventos" && (
        <div className="mt-6">
          <ProventosTab currency={initialCurrency} locale={initialLocale} />
        </div>
      )}

      {activeTab === "intelligence" && (
        <div className="mt-6">
          <IntelligenceTab
            portfolioTotalValue={portfolioData?.totals.totalCurrentValue ?? 0}
            currency={initialCurrency}
          />
        </div>
      )}
    </div>
  );
}

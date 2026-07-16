"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { PeriodFilter } from "@/components/shared/PeriodFilter";
import { CashFlowChart } from "./fluxo-caixa/CashFlowChart";
import { HealthScoreCard } from "./visao-geral/HealthScoreCard";
import { InsightsCard } from "./visao-geral/InsightsCard";
import { SpendingVelocityCard } from "./visao-geral/SpendingVelocityCard";
import { RecurringList } from "./fluxo-caixa/RecurringList";
import { SankeyDiagram } from "./fluxo-caixa/SankeyDiagram";
import { CategoryTrendChart } from "./tendencias/CategoryTrendChart";
import { MerchantSpotlight } from "./tendencias/MerchantSpotlight";
import { SeasonalAnalysis } from "./tendencias/SeasonalAnalysis";
import type { OverviewData, CashflowData } from "./types";

type TabKey = "overview" | "cashflow" | "trends";

interface TabData<T> {
  data: T | null;
  loading: boolean;
}

interface ReportsShellProps {
  initialCurrency: string;
  initialLocale: string;
}

function getCurrentMonthISO(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const m = String(month).padStart(2, "0");
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${String(lastDay).padStart(2, "0")}` };
}

export function ReportsShell({ initialCurrency, initialLocale }: ReportsShellProps) {
  const t = useTranslations("Reports");
  const { start: defaultStart, end: defaultEnd } = getCurrentMonthISO();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [period, setPeriod] = useState({ start: defaultStart, end: defaultEnd });

  const [overviewState, setOverviewState] = useState<TabData<OverviewData>>({ data: null, loading: false });
  const [cashflowState, setCashflowState] = useState<TabData<CashflowData>>({ data: null, loading: false });
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async (start: string, end: string) => {
    setOverviewState((s) => ({ ...s, loading: true }));
    setError(null);
    try {
      const res = await fetch(`/api/reports/overview?start=${start}&end=${end}`);
      if (res.ok) {
        const data = await res.json();
        setOverviewState({ data, loading: false });
      } else {
        setOverviewState({ data: null, loading: false });
      }
    } catch {
      setOverviewState({ data: null, loading: false });
      setError("Não foi possível carregar os dados.");
    }
  }, []);

  const fetchCashflow = useCallback(async (start: string, end: string) => {
    setCashflowState((s) => ({ ...s, loading: true }));
    setError(null);
    try {
      const res = await fetch(`/api/reports/cashflow?start=${start}&end=${end}`);
      if (res.ok) {
        const data = await res.json();
        setCashflowState({ data, loading: false });
      } else {
        setCashflowState({ data: null, loading: false });
      }
    } catch {
      setCashflowState({ data: null, loading: false });
      setError("Não foi possível carregar os dados.");
    }
  }, []);

  // Fetch quando aba muda ou período muda
  useEffect(() => {
    if (activeTab === "overview") {
      fetchOverview(period.start, period.end);
    } else if (activeTab === "cashflow") {
      fetchCashflow(period.start, period.end);
    }
    // trends: cada componente filho faz seu próprio fetch
  }, [activeTab, period, fetchOverview, fetchCashflow]);

  function handlePeriodChange(start: string, end: string) {
    setPeriod({ start, end });
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "overview", label: t("tabOverview") },
    { key: "cashflow", label: t("tabCashflow") },
    { key: "trends", label: t("tabTrends") },
  ];

  return (
    <div className="space-y-6">
      {/* Filtro de período */}
      <PeriodFilter onChange={handlePeriodChange} />
      {error && (
        <div className="text-axiom-expense text-sm p-4">{error}</div>
      )}

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

      {/* Conteúdo da aba ativa */}
      {activeTab === "overview" && (
        <OverviewTab
          data={overviewState.data}
          loading={overviewState.loading}
          currency={initialCurrency}
          locale={initialLocale}
          periodStart={period.start}
        />
      )}

      {activeTab === "cashflow" && (
        <CashflowTab
          data={cashflowState.data}
          loading={cashflowState.loading}
          currency={initialCurrency}
          locale={initialLocale}
        />
      )}

      {activeTab === "trends" && (
        <TrendsTab
          currency={initialCurrency}
          locale={initialLocale}
          period={period}
        />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder de aba — será substituído pelos componentes reais nas issues 2-11
// ---------------------------------------------------------------------------

function SkeletonCard({ label }: { label: string }) {
  return (
    <div className="bg-axiom-card border border-axiom-border rounded-xl p-6 flex flex-col gap-4">
      <p className="text-axiom-muted text-sm font-medium">{label}</p>
      <div className="flex-1 animate-pulse bg-axiom-hover rounded-lg h-32" />
    </div>
  );
}

function OverviewTab({
  data,
  loading,
  currency: _currency,
  locale: _locale,
  periodStart: _periodStart,
}: {
  data: OverviewData | null;
  loading: boolean;
  currency: string;
  locale: string;
  periodStart: string;
}) {
  const t = useTranslations("Reports");

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <SkeletonCard label={t("healthScore")} />
        <SkeletonCard label={t("insights")} />
        <SkeletonCard label={t("spendingVelocity")} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
      <HealthScoreCard overviewData={data} />
      <InsightsCard overviewData={data} />
      <SpendingVelocityCard
        overviewData={data}
        currency={_currency}
        locale={_locale}
        periodStart={_periodStart}
      />
    </div>
  );
}

function CashflowTab({
  data,
  loading,
  currency,
  locale,
}: {
  data: CashflowData | null;
  loading: boolean;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("Reports");

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SkeletonCard label={t("cashFlow")} />
        <SkeletonCard label={t("recurring")} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div style={{ minHeight: 360 }}>
        <CashFlowChart cashflowData={data} currency={currency} locale={locale} />
      </div>
      <div style={{ minHeight: 280 }}>
        <SankeyDiagram cashflowData={data} />
      </div>
      <RecurringList currency={currency} />
    </div>
  );
}

function TrendsTab({
  currency,
  locale,
  period,
}: {
  currency: string;
  locale: string;
  period: { start: string; end: string };
}) {
  const t = useTranslations("Reports");
  return (
    <div className="grid grid-cols-1 gap-4">
      <div style={{ minHeight: 380 }}>
        <CategoryTrendChart currency={currency} locale={locale} period={period} />
      </div>
      <MerchantSpotlight currency={currency} period={period} />
      <SeasonalAnalysis />
    </div>
  );
}


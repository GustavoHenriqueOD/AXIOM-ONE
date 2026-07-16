"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FireStatusCard } from "./FireStatusCard";
import { FireSettingsCard } from "./FireSettingsCard";
import { FireProjectionChart } from "./FireProjectionChart";
import { CoastFireCard } from "./CoastFireCard";
import { FireGoalsCard } from "./FireGoalsCard";
import { FirePlanCard } from "./FirePlanCard";
import { FireMetricsCard } from "./FireMetricsCard";
import { GoalCard } from "./GoalCard";
import type { NetworthData } from "@/components/reports/types";
import type {
  WealthItemsResponse,
  FireSettingsResponse,
  FireResponse,
  FireEssentialsResponse,
  FinancialGoalSerialized,
} from "@/types/fire";

interface PortfolioTotals {
  totalCurrentValue: number;
}
interface PortfolioData {
  totals: PortfolioTotals;
}

function SkeletonBlock({ h = 180 }: { h?: number }) {
  return (
    <div
      className="bg-axiom-card border border-axiom-border rounded-xl animate-pulse"
      style={{ minHeight: h }}
    />
  );
}

interface FireDashboardProps {
  currency: string;
  locale: string;
}

export function FireDashboard({ currency, locale }: FireDashboardProps) {
  const [networthData, setNetworthData] = useState<NetworthData | null>(null);
  const [itemsData, setItemsData] = useState<WealthItemsResponse | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fireSettings, setFireSettings] = useState<FireSettingsResponse | null>(null);
  const [goals, setGoals] = useState<FinancialGoalSerialized[]>([]);
  const [essentialsData, setEssentialsData] = useState<FireEssentialsResponse | null>(null);
  const [cdiAnual, setCdiAnual] = useState<number | null>(null);
  const [ipcaAnual, setIpcaAnual] = useState<number | null>(null);
  const [fireData, setFireData] = useState<FireResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fireLoading, setFireLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inputs editáveis
  const [extraSavings, setExtraSavings] = useState(0);
  const [fireMonthlyExpense, setFireMonthlyExpense] = useState<number | null>(null);
  const [targetMonthlyIncome, setTargetMonthlyIncome] = useState<number | null>(null);
  const [retirementYears, setRetirementYears] = useState(30);
  const [expensePeriod, setExpensePeriod] = useState<3 | 6 | 12>(12);
  const [fiNumberManual, setFiNumberManual] = useState<number | null>(null);
  const [expectedReturn, setExpectedReturn] = useState<number>(8);

  // Debounce refs
  const fireDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [nwRes, itemsRes, portRes, settingsRes, goalsRes, benchRes, essentialsRes] = await Promise.allSettled([
      fetch("/api/reports/networth"),
      fetch("/api/patrimonio/items"),
      fetch("/api/investments/portfolio"),
      fetch("/api/patrimonio/fire-settings"),
      fetch("/api/patrimonio/goals"),
      fetch("/api/investments/benchmarks"),
      fetch("/api/reports/fire-essentials"),
    ]);

    if (nwRes.status === "fulfilled" && nwRes.value.ok)
      setNetworthData(await nwRes.value.json());
    if (itemsRes.status === "fulfilled" && itemsRes.value.ok)
      setItemsData(await itemsRes.value.json());
    if (portRes.status === "fulfilled" && portRes.value.ok)
      setPortfolioData(await portRes.value.json());
    if (settingsRes.status === "fulfilled" && settingsRes.value.ok) {
      const s: FireSettingsResponse = await settingsRes.value.json();
      setFireSettings(s);
      if (s.monthlyExpense !== null) setFireMonthlyExpense(s.monthlyExpense);
      if (s.targetMonthlyIncome !== null) setTargetMonthlyIncome(s.targetMonthlyIncome);
      if (s.retirementYears !== null) setRetirementYears(s.retirementYears);
      if (s.fiNumberManual !== null) setFiNumberManual(s.fiNumberManual);
      else if (s.targetInvestedAmount !== null) setFiNumberManual(s.targetInvestedAmount);
      if (s.swr !== null && s.swr > 0) setExpectedReturn(s.swr);
    }
    if (goalsRes.status === "fulfilled" && goalsRes.value.ok) {
      const d = await goalsRes.value.json();
      setGoals(d.goals ?? []);
    }
    if (benchRes.status === "fulfilled" && benchRes.value.ok) {
      const d = await benchRes.value.json();
      if (d.selicAnual) {
        setCdiAnual(d.selicAnual);
        // usar CDI como padrão inicial se não tiver taxa salva
        setExpectedReturn((prev) => (prev === 8 ? Math.round(d.selicAnual) : prev));
      }
      if (d.ipca) setIpcaAnual(d.ipca * 12); // ipca vem mensal → anualizar
    }
    if (essentialsRes.status === "fulfilled" && essentialsRes.value.ok) {
      setEssentialsData(await essentialsRes.value.json());
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Médias calculadas com janela configurável
  const allMonths = networthData?.months ?? [];

  const avgMonthlyIncome =
    allMonths.length > 0
      ? allMonths
          .filter((m) => m.monthIncome > 0)
          .reduce((s, m) => s + m.monthIncome, 0) /
        Math.max(1, allMonths.filter((m) => m.monthIncome > 0).length)
      : 0;

  const avgMonthlyExpenses =
    allMonths.length > 0
      ? allMonths.reduce((s, m) => s + m.monthExpenses, 0) / allMonths.length
      : 0;

  // Média de despesas pelo período selecionado (últimos N meses)
  const periodMonths = allMonths.slice(-expensePeriod);
  const avgExpensesByPeriod =
    periodMonths.length > 0
      ? periodMonths.reduce((s, m) => s + m.monthExpenses, 0) / periodMonths.length
      : avgMonthlyExpenses;

  // Aporte médio mensal (income - expenses, quando positivo)
  const avgMonthlyContrib =
    allMonths.length > 0
      ? allMonths.reduce((s, m) => s + Math.max(0, m.monthIncome - m.monthExpenses), 0) /
        allMonths.length
      : 0;

  // Para FIRE, só o portfólio investido conta — bens físicos (imóvel, carro)
  // não geram renda passiva e não contribuem para atingir o FI Number
  const firePatrimony = portfolioData?.totals.totalCurrentValue ?? 0;

  const totalInvested = portfolioData?.totals.totalCurrentValue ?? 0;

  const effectiveMonthlyExpense = fireMonthlyExpense ?? avgExpensesByPeriod;
  const effectiveMonthlyIncome = avgMonthlyIncome * (1 + extraSavings / 100);
  const savingsRate =
    effectiveMonthlyIncome > 0
      ? ((effectiveMonthlyIncome - effectiveMonthlyExpense) / effectiveMonthlyIncome) * 100
      : 0;
  const isUsingAvgExpenses = fireMonthlyExpense === null;

  // Busca fire API com debounce 400ms quando inputs mudam
  const fetchFire = useCallback(
    (
      patrimony: number,
      income: number,
      expenses: number,
      targetIncome: number | null,
      years: number,
      fiNumManual: number | null,
      monthlyContrib: number | null,
      cdiAnual: number | null,
      expectedReturn: number
    ) => {
      if (income <= 0) return;
      if (fireDebounce.current) clearTimeout(fireDebounce.current);
      fireDebounce.current = setTimeout(async () => {
        setFireLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams({
            patrimony: String(patrimony),
            monthlyIncome: String(income),
            monthlyExpenses: String(expenses),
            retirementYears: String(years),
            ...(targetIncome && targetIncome > 0
              ? { targetMonthlyIncome: String(targetIncome) }
              : {}),
            ...(fiNumManual && fiNumManual > 0
              ? { fiNumberManual: String(fiNumManual) }
              : {}),
            ...(monthlyContrib && monthlyContrib > 0
              ? { targetMonthlyContrib: String(monthlyContrib) }
              : {}),
            ...(cdiAnual != null && cdiAnual > 0
              ? { cdiAnual: String(cdiAnual) }
              : {}),
            expectedReturn: String(expectedReturn),
          });
          const res = await fetch(`/api/reports/fire?${params}`);
          if (res.ok) setFireData(await res.json());
        } catch {
          setError("Não foi possível carregar os dados.");
        } finally {
          setFireLoading(false);
        }
      }, 400);
    },
    []
  );

  const targetMonthlyContrib = fireSettings?.targetMonthlyContrib ?? null;

  useEffect(() => {
    if (!loading && avgMonthlyIncome > 0) {
      fetchFire(
        firePatrimony,
        effectiveMonthlyIncome,
        effectiveMonthlyExpense,
        targetMonthlyIncome,
        retirementYears,
        fiNumberManual,
        targetMonthlyContrib,
        cdiAnual,
        expectedReturn
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading,
    firePatrimony,
    effectiveMonthlyIncome,
    effectiveMonthlyExpense,
    targetMonthlyIncome,
    retirementYears,
    fiNumberManual,
    targetMonthlyContrib,
    cdiAnual,
    expectedReturn,
  ]);

  // PATCH fire-settings com debounce
  function patchFireSettings(patch: Partial<FireSettingsResponse>) {
    if (settingsDebounce.current) clearTimeout(settingsDebounce.current);
    settingsDebounce.current = setTimeout(async () => {
      await fetch("/api/patrimonio/fire-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    }, 400);
  }

  function handleMonthlyExpenseChange(v: number) {
    setFireMonthlyExpense(v);
    patchFireSettings({ monthlyExpense: v });
  }

  function handleTargetMonthlyIncomeChange(v: number) {
    setTargetMonthlyIncome(v);
    patchFireSettings({ targetMonthlyIncome: v });
  }

  function handleRetirementYearsChange(v: number) {
    setRetirementYears(v);
    patchFireSettings({ retirementYears: v });
  }

  function handleExpectedReturnChange(v: number) {
    setExpectedReturn(v);
    patchFireSettings({ swr: v }); // reutilizando campo legado para persistir
  }

  function handleTargetMonthlyContribChange(v: number) {
    setFireSettings((prev) => (prev ? { ...prev, targetMonthlyContrib: v } : prev));
    patchFireSettings({ targetMonthlyContrib: v });
  }

  function handleFiNumberChange(v: number | null) {
    setFiNumberManual(v);
    setFireSettings((prev) => (prev ? { ...prev, targetInvestedAmount: v } : prev));
    patchFireSettings({ fiNumberManual: v, targetInvestedAmount: v });
  }

  function handleGoalSave(field: keyof FireSettingsResponse, value: number | null) {
    setFireSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    // targetInvestedAmount e fiNumberManual são a mesma coisa — salvar ambos juntos
    if (field === "targetInvestedAmount") {
      setFiNumberManual(value);
      patchFireSettings({ targetInvestedAmount: value, fiNumberManual: value });
    } else {
      patchFireSettings({ [field]: value });
    }
    // Se alterou targetMonthlyIncome, propagar para o estado local
    if (field === "targetMonthlyIncome") setTargetMonthlyIncome(value);
    if (field === "targetInvestedAmount") setFiNumberManual(value);
  }

  // Aportes mensais das metas
  const totalGoalContrib = goals
    .filter((g) => g.contributionFrequency === "MONTHLY")
    .reduce((s, g) => s + g.contributionAmount, 0);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonBlock h={160} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SkeletonBlock h={200} />
          <SkeletonBlock h={200} />
        </div>
        <SkeletonBlock h={240} />
        <SkeletonBlock h={260} />
      </div>
    );
  }

  if (avgMonthlyIncome === 0) {
    return (
      <div className="bg-axiom-card border border-axiom-border rounded-xl p-6 text-center">
        <p className="text-white font-semibold">Sem dados de renda</p>
        <p className="text-sm text-axiom-muted mt-1">
          Registre transações de renda para ativar a projeção de independência financeira.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="text-axiom-expense text-sm p-4">{error}</div>
      )}
      {/* Metas pessoais */}
      {fireSettings && (
        <FireGoalsCard
          settings={fireSettings}
          avgMonthlyIncome={avgMonthlyIncome}
          avgMonthlyContrib={avgMonthlyContrib}
          totalInvested={totalInvested}
          currency={currency}
          locale={locale}
          onSave={handleGoalSave}
        />
      )}

      {/* Custo de vida real */}
      {essentialsData && (
        <FirePlanCard
          essentialCategories={essentialsData.categories}
          liabilityCosts={essentialsData.liabilityCosts}
          totalEssentialMonthly={essentialsData.totalEssentialMonthly}
          currency={currency}
          locale={locale}
        />
      )}

      {/* Status + Settings lado a lado */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FireStatusCard
          firePatrimony={firePatrimony}
          fiNumber={
            fireData?.fiNumber ??
            (targetMonthlyIncome ?? effectiveMonthlyExpense) * 12 * 25
          }
          savingsRate={Math.max(0, savingsRate)}
          avgMonthlyIncome={effectiveMonthlyIncome}
          effectiveMonthlyExpense={effectiveMonthlyExpense}
          currency={currency}
          locale={locale}
          fiNumberManual={fiNumberManual}
          onFiNumberChange={handleFiNumberChange}
          cdiAnual={cdiAnual}
          ipcaAnual={ipcaAnual}
          targetMonthlyContrib={fireSettings?.targetMonthlyContrib ?? null}
        />
        <FireSettingsCard
          targetMonthlyContrib={fireSettings?.targetMonthlyContrib ?? null}
          extraSavings={extraSavings}
          expectedReturn={expectedReturn}
          cdiAnual={cdiAnual}
          onTargetMonthlyContribChange={handleTargetMonthlyContribChange}
          onExtraSavingsChange={setExtraSavings}
          onExpectedReturnChange={handleExpectedReturnChange}
          currency={currency}
          locale={locale}
        />
      </div>

      {/* Métricas complementares */}
      <FireMetricsCard
        firePatrimony={firePatrimony}
        fiNumber={fireData?.fiNumber ?? effectiveMonthlyExpense * 12 * 25}
        effectiveMonthlyExpense={effectiveMonthlyExpense}
        avgMonthlyExpense={allMonths.length >= 3 ? avgMonthlyExpenses : effectiveMonthlyExpense}
        currency={currency}
        locale={locale}
      />

      {/* Gráfico de projeção */}
      {fireLoading || !fireData?.scenarios ? (
        <SkeletonBlock h={280} />
      ) : (
        <FireProjectionChart
          scenarios={fireData.scenarios}
          fiNumber={fireData.fiNumber ?? 0}
          currency={currency}
          locale={locale}
        />
      )}

      {/* Coast FIRE */}
      {!fireLoading && fireData?.coastFireNumber !== undefined && (
        <CoastFireCard
          coastFireNumber={fireData.coastFireNumber}
          firePatrimony={firePatrimony}
          fiNumber={fireData.fiNumber ?? 0}
          retirementYears={retirementYears}
          cdiAnual={expectedReturn}
          targetMonthlyContrib={fireSettings?.targetMonthlyContrib ?? null}
          ipcaAnual={ipcaAnual}
          currency={currency}
          locale={locale}
        />
      )}

      {/* Metas conectadas */}
      {goals.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Metas Conectadas</h3>
              <p className="text-xs text-axiom-muted mt-0.5">
                Como seus aportes mensais impactam o plano FIRE
              </p>
            </div>
            {totalGoalContrib > 0 && (
              <span className="text-xs text-axiom-primary font-medium">
                Total aportes:{" "}
                {new Intl.NumberFormat(locale, { style: "currency", currency }).format(
                  totalGoalContrib
                )}
                /mês
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                currency={currency}
                locale={locale}
                cdiAnual={cdiAnual}
                onEdit={() => {}}
                onDelete={async () => {}}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

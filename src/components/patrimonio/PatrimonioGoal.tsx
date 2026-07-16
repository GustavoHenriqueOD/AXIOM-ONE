"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface PatrimonioGoalProps {
  currentNetWorth: number;
  goal: number | null;
  avgMonthlySavings: number;
  currency: string;
  locale: string;
  onGoalSaved?: () => void;
}

export function PatrimonioGoal({
  currentNetWorth,
  goal,
  avgMonthlySavings,
  currency,
  locale,
  onGoalSaved,
}: PatrimonioGoalProps) {
  const [editMode, setEditMode] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const parsed = parseFloat(inputValue.replace(",", "."));
    if (isNaN(parsed) || parsed <= 0) return;
    setSaving(true);
    try {
      await fetch("/api/patrimonio/target", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: parsed }),
      });
      setEditMode(false);
      setInputValue("");
      onGoalSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await fetch("/api/patrimonio/target", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: null }),
      });
      onGoalSaved?.();
    } finally {
      setSaving(false);
    }
  }

  // Projeção de data
  let projectionLabel: string | null = null;
  if (goal !== null && avgMonthlySavings > 0 && currentNetWorth < goal) {
    const monthsToGoal = Math.ceil((goal - currentNetWorth) / avgMonthlySavings);
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + monthsToGoal);
    projectionLabel = targetDate.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }

  const progressPct = goal !== null ? Math.min(100, Math.max(0, (currentNetWorth / goal) * 100)) : 0;

  return (
    <div className="bg-axiom-card border border-axiom-border rounded-xl p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Meta de Patrimônio</h3>
          <p className="text-xs text-axiom-muted mt-0.5">Defina um objetivo e acompanhe seu progresso</p>
        </div>
      </div>

      {/* Sem meta */}
      {goal === null && !editMode && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-axiom-muted">Você ainda não definiu uma meta de patrimônio.</p>
          <button
            onClick={() => setEditMode(true)}
            className="self-start px-4 py-2 rounded-lg bg-axiom-primary text-white text-sm font-medium hover:bg-axiom-primary/90 transition-colors"
          >
            Definir meta
          </button>
        </div>
      )}

      {/* Modo edição */}
      {editMode && (
        <div className="flex flex-col gap-3">
          <label className="text-xs text-axiom-muted font-medium">Meta em {currency}</label>
          <input
            type="number"
            min="1"
            step="1000"
            placeholder="Ex: 500000"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="bg-axiom-hover border border-axiom-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-axiom-muted focus:outline-none focus:border-axiom-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !inputValue}
              className="px-4 py-2 rounded-lg bg-axiom-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-axiom-primary/90 transition-colors"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setEditMode(false); setInputValue(""); }}
              className="px-4 py-2 rounded-lg bg-axiom-hover border border-axiom-border text-axiom-muted text-sm hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Com meta — modo visualização */}
      {goal !== null && !editMode && (
        <div className="flex flex-col gap-4">
          {/* Valores */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-axiom-muted">Atual</p>
              <p className="text-lg font-bold text-white">
                {formatCurrency(currentNetWorth, locale, currency)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-axiom-muted">Meta</p>
              <p className="text-lg font-bold text-axiom-primary">
                {formatCurrency(goal, locale, currency)}
              </p>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="flex flex-col gap-1.5">
            <div className="w-full bg-axiom-hover rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 rounded-full bg-axiom-primary transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-axiom-muted">
              <span>{progressPct.toFixed(1)}% concluído</span>
              {currentNetWorth >= goal && (
                <span className="text-axiom-income font-medium">Meta atingida!</span>
              )}
            </div>
          </div>

          {/* Projeção */}
          {projectionLabel && (
            <div className="px-3 py-2 rounded-lg bg-axiom-hover border border-axiom-border">
              <p className="text-xs text-axiom-muted">
                Estimativa:{" "}
                <span className="text-white font-medium">{projectionLabel}</span>
                {" "}— com aporte médio de{" "}
                <span className="text-white font-medium">
                  {formatCurrency(avgMonthlySavings, locale, currency)}/mês
                </span>
              </p>
            </div>
          )}

          {avgMonthlySavings <= 0 && currentNetWorth < goal && (
            <p className="text-xs text-axiom-muted italic">
              Aumente sua renda ou reduza gastos para projetar quando atingirá a meta.
            </p>
          )}

          {/* Ações */}
          <div className="flex gap-2">
            <button
              onClick={() => { setEditMode(true); setInputValue(String(goal)); }}
              className="px-3 py-1.5 rounded-lg bg-axiom-hover border border-axiom-border text-axiom-muted text-xs hover:text-white transition-colors"
            >
              Editar meta
            </button>
            <button
              onClick={handleRemove}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-axiom-muted text-xs hover:text-axiom-expense transition-colors disabled:opacity-50"
            >
              {saving ? "Removendo..." : "Remover meta"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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

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

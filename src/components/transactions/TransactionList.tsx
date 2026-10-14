"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionTable, type Transaction } from "./TransactionTable";
import { TransactionDialog } from "./TransactionDialog";
import { CategoriesManager } from "@/components/settings/CategoriesManager";
import type { Category } from "@/generated/prisma/client";

const PAGE_SIZE = 50;

type ActiveTab = "transactions" | "categories";

type FilterType = "ALL" | "INCOME" | "EXPENSE";

interface Filters {
  type: FilterType;
  categoryId: string | null;
  month: string | null;
}

type DialogState =
  | null
  | { mode: "create" }
  | { mode: "edit"; transaction: Transaction };

interface TransactionListProps {
  transactions: Transaction[];
  categories: Category[];
}

export function TransactionList({ transactions: initial, categories: initialCategories }: TransactionListProps) {
  const t = useTranslations("Transactions");
  const [activeTab, setActiveTab] = useState<ActiveTab>("transactions");
  const [transactions, setTransactions] = useState<Transaction[]>(initial);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [filters, setFilters] = useState<Filters>({ type: "ALL", categoryId: null, month: null });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = transactions.filter((tx) => {
    if (filters.type !== "ALL" && tx.type !== filters.type) return false;
    if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
    if (filters.month) {
      const txMonth = new Date(tx.date).toISOString().slice(0, 7);
      if (txMonth !== filters.month) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleFilterChange(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTransactions((prev) => prev.filter((tx) => tx.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  function handleSuccess(tx: Transaction) {
    setTransactions((prev) => {
      const exists = prev.find((t) => t.id === tx.id);
      if (exists) return prev.map((t) => (t.id === tx.id ? tx : t));
      return [tx, ...prev];
    });
    setDialog(null);
  }

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

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: "transactions", label: "Transações" },
    { key: "categories", label: "Categorias" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex bg-axiom-hover rounded-lg p-1 gap-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key ? "bg-axiom-primary text-white" : "text-axiom-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "transactions" && (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TransactionFilters
              filters={filters}
              onFilterChange={handleFilterChange}
              categories={categories}
            />
            <Button
              onClick={handleExportCSV}
              variant="outline"
              className="border-axiom-border text-axiom-muted hover:text-white hover:bg-axiom-hover gap-1.5 h-9 text-sm shrink-0"
            >
              <Download size={15} />
              Exportar CSV
            </Button>
            <Button
              onClick={() => setDialog({ mode: "create" })}
              className="bg-axiom-primary hover:bg-axiom-primary/90 text-white gap-1.5 h-9 text-sm shrink-0"
            >
              <Plus size={15} />
              {t("newButton")}
            </Button>
          </div>

          <TransactionTable
            transactions={paginated}
            onEdit={(tx) => setDialog({ mode: "edit", transaction: tx })}
            onDelete={handleDelete}
            deletingId={deletingId}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-axiom-muted pt-1">
              <span>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length} transações
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1.5 rounded hover:bg-axiom-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 text-white">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-1.5 rounded hover:bg-axiom-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {dialog && (
            <TransactionDialog
              mode={dialog.mode}
              transaction={dialog.mode === "edit" ? dialog.transaction : undefined}
              categories={categories}
              onSuccess={handleSuccess}
              onClose={() => setDialog(null)}
            />
          )}
        </>
      )}

      {activeTab === "categories" && (
        <div className="bg-axiom-card border border-axiom-border rounded-xl p-6">
          <CategoriesManager
            initialCategories={categories}
            onCategoriesChange={setCategories}
          />
        </div>
      )}
    </div>
  );
}

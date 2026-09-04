"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ImportInlineCategorySelect } from "./ImportInlineCategorySelect";
import { formatCurrency } from "@/lib/utils";
import type { ParsedRow, ReviewedRow } from "@/lib/import/types";
import type { Category } from "@/generated/prisma/client";

interface ImportPreviewTableProps {
  rows: ParsedRow[];
  categories: Category[];
  onConfirm: (rows: ReviewedRow[]) => void;
  onBack: () => void;
  isImporting: boolean;
}

export function ImportPreviewTable({
  rows,
  categories: initialCategories,
  onConfirm,
  onBack,
  isImporting,
}: ImportPreviewTableProps) {
  const t = useTranslations("Import");
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [reviewed, setReviewed] = useState<ReviewedRow[]>(() =>
    rows.map((r) => ({
      ...r,
      description: r.cleanDescription,
      categoryId: r.suggestedCategoryId ?? null,
      skip: false,
    }))
  );

  const limboCategoryId = categories.find((c) => c.name === "Limbo")?.id;

  const active = reviewed.filter((r) => !r.skip);
  const unmatched = active.filter((r) => !r.categoryId).length;
  const limboCount = limboCategoryId
    ? active.filter((r) => r.categoryId === limboCategoryId).length
    : 0;
  const total = active.reduce((sum, r) => sum + r.amount, 0);
  const canConfirm = active.length > 0 && unmatched === 0 && !isImporting;

  function updateRow(index: number, patch: Partial<ReviewedRow>) {
    setReviewed((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function handleCategoryCreated(cat: Category) {
    setCategories((prev) => [...prev, cat]);
  }

  function formatDate(dateStr: string) {
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  }

  return (
    <div className="space-y-4">
      {unmatched > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{t("noCategoryWarning", { count: unmatched })}</span>
        </div>
      )}
      {limboCount > 0 && unmatched === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-axiom-hover border border-axiom-border text-axiom-muted text-sm">
          <Inbox size={16} className="shrink-0 text-axiom-primary" />
          <span>
            <span className="text-white font-medium">{limboCount}</span>{" "}
            {limboCount === 1
              ? "transação foi para o Limbo"
              : "transações foram para o Limbo"}{" "}
            — você pode ajustar as categorias agora ou depois em{" "}
            <span className="text-white">Transações</span>.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-axiom-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-axiom-border hover:bg-transparent">
              <TableHead className="text-axiom-muted w-10 text-center">{t("colSkip")}</TableHead>
              <TableHead className="text-axiom-muted">{t("colDate")}</TableHead>
              <TableHead className="text-axiom-muted">{t("colDescription")}</TableHead>
              <TableHead className="text-axiom-muted">{t("colType")}</TableHead>
              <TableHead className="text-axiom-muted text-right">{t("colAmount")}</TableHead>
              <TableHead className="text-axiom-muted w-48">{t("colCategory")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviewed.map((row, idx) => (
              <TableRow
                key={row.id}
                className={`border-axiom-border hover:bg-axiom-hover/50 transition-opacity ${
                  row.skip ? "opacity-40" : ""
                }`}
              >
                <TableCell className="text-center">
                  <input
                    type="checkbox"
                    checked={row.skip}
                    onChange={(e) => updateRow(idx, { skip: e.target.checked })}
                    className="w-4 h-4 accent-axiom-primary cursor-pointer"
                  />
                </TableCell>
                <TableCell className="text-axiom-muted text-sm whitespace-nowrap">
                  {formatDate(row.date)}
                </TableCell>
                <TableCell>
                  <Input
                    value={row.description}
                    onChange={(e) => updateRow(idx, { description: e.target.value })}
                    disabled={row.skip}
                    className="bg-transparent border-transparent hover:border-axiom-border focus:border-axiom-primary text-white text-xs h-7 px-2 min-w-[160px]"
                  />
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      row.type === "INCOME"
                        ? "bg-axiom-income/20 text-axiom-income border-axiom-income/30 text-xs"
                        : "bg-axiom-expense/20 text-axiom-expense border-axiom-expense/30 text-xs"
                    }
                  >
                    {row.type === "INCOME" ? t("typeIncome") : t("typeExpense")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`text-sm font-medium ${
                      row.type === "INCOME" ? "text-axiom-income" : "text-axiom-expense"
                    }`}
                  >
                    {row.type === "EXPENSE" ? "-" : "+"}
                    {formatCurrency(row.amount)}
                  </span>
                </TableCell>
                <TableCell>
                  {!row.skip && (
                    <ImportInlineCategorySelect
                      value={row.categoryId}
                      onChange={(id) => updateRow(idx, { categoryId: id })}
                      categories={categories}
                      onCategoryCreated={handleCategoryCreated}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
        <p className="text-axiom-muted text-sm">
          {t("selectedSummary", { count: active.length, total: formatCurrency(total) })}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isImporting}
            className="border-axiom-border text-axiom-muted hover:text-white hover:bg-axiom-hover"
          >
            {t("backButton")}
          </Button>
          <Button
            onClick={() => onConfirm(reviewed.filter((r) => !r.skip))}
            disabled={!canConfirm}
            className="bg-axiom-primary hover:bg-axiom-primary/90 text-white gap-2"
          >
            {isImporting && <Loader2 size={14} className="animate-spin" />}
            {isImporting ? t("importing") : t("confirmButton", { count: active.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}

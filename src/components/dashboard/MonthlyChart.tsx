"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useTranslations, useLocale } from "next-intl";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface MonthlyData {
  month: string;
  income: number;
  expenses: number;
}

interface MonthlyChartProps {
  data: MonthlyData[];
  currency?: string;
}

export function MonthlyChart({ data, currency = "BRL" }: MonthlyChartProps) {
  const t = useTranslations("MonthlyChart");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chartData = {
    labels: data.map((d) => d.month),
    datasets: [
      {
        label: t("income"),
        data: data.map((d) => d.income),
        backgroundColor: "#10B981",
        borderRadius: 4,
        borderSkipped: false,
      },
      {
        label: t("expenses"),
        data: data.map((d) => d.expenses),
        backgroundColor: "#FF6B35",
        borderRadius: 4,
        borderSkipped: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 1000,
      easing: "easeOutQuart" as const,
    },
    plugins: {
      legend: {
        labels: {
          color: "#AAB2BD",
          font: { size: 12 },
          boxWidth: 12,
          boxHeight: 12,
        },
      },
      tooltip: {
        backgroundColor: "#152030",
        borderColor: "#1E2D42",
        borderWidth: 1,
        titleColor: "#AAB2BD",
        bodyColor: "#fff",
        padding: 10,
        callbacks: {
          label: (ctx: { dataset: { label: string }; parsed: { y: number } }) => {
            const val = new Intl.NumberFormat(locale, {
              style: "currency",
              currency,
            }).format(ctx.parsed.y);
            return ` ${ctx.dataset.label}: ${val}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#AAB2BD", font: { size: 12 } },
        border: { display: false },
      },
      y: {
        grid: { color: "#1E2D42" },
        ticks: {
          color: "#AAB2BD",
          font: { size: 12 },
          callback: (val: number | string) => {
            const n = Number(val);
            return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
          },
        },
        border: { display: false },
      },
    },
  };

  const scrollable = data.length > 6;
  // 90px per month gives each bar-group enough room
  const chartMinWidth = data.length * 90;

  return (
    <div className="bg-axiom-card border border-axiom-border rounded-xl p-5 h-full flex flex-col">
      <h3 className="text-white font-semibold mb-4">{t("title")}</h3>
      <div className={`flex-1 min-h-0 ${scrollable ? "overflow-x-auto" : ""}`}>
        <div
          className="h-full"
          style={scrollable ? { minWidth: `${chartMinWidth}px` } : {}}
        >
          {mounted ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Bar data={chartData} options={options as any} />
          ) : (
            <div className="w-full h-full rounded-lg bg-axiom-hover animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

import { toNumber } from "@/lib/utils";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchDividends } from "@/lib/dividends";
import type { ProventosData, ProventosAsset } from "@/components/investments/proventos/types";

const BRAPI_ELIGIBLE = ["STOCK", "BDR", "ETF", "STOCK_INT"];

function cutoffDate(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assets = await prisma.asset.findMany({
    where: { userId: session.user.id },
    include: { entries: { orderBy: { date: "asc" } } },
  });

  const cutoff6m = cutoffDate(6);
  const cutoff12m = cutoffDate(12);
  const cutoff24m = cutoffDate(24);

  let totalReceived = 0;
  let last6m = 0;
  let last12m = 0;
  let last24m = 0;

  const monthlyMap = new Map<string, number>();
  const byCategoryMap = new Map<string, number>();
  const proventosAssets: ProventosAsset[] = [];

  for (const asset of assets) {
    const dividendEntries = asset.entries.filter((e) => e.type === "DIVIDEND");
    if (dividendEntries.length === 0) continue;

    // Aggregate position data from PURCHASE/SALE entries
    let totalQty = 0;
    let totalCost = 0;
    for (const e of asset.entries) {
      const qty = toNumber(e.quantity);
      const price = toNumber(e.price);
      if (e.type === "PURCHASE") {
        totalCost += qty * price;
        totalQty += qty;
      } else if (e.type === "SALE") {
        if (totalQty > 0) {
          const avgCostNow = totalCost / totalQty;
          totalCost -= qty * avgCostNow;
        }
        totalQty -= qty;
      } else if (e.type === "SPLIT") {
        totalQty = qty;
      }
    }
    if (totalQty < 0.000001) totalQty = 0;
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    // Dividend aggregations
    let assetTotalDivs = 0;
    let lastDividendDate: string | null = null;
    let lastDividendAmount = 0;
    let div12m = 0;

    for (const e of dividendEntries) {
      const amount = toNumber(e.amount);
      const entryDate = new Date(e.date);
      assetTotalDivs += amount;

      // Global KPIs
      totalReceived += amount;
      if (entryDate >= cutoff6m) last6m += amount;
      if (entryDate >= cutoff12m) {
        last12m += amount;
        div12m += amount;
      }
      if (entryDate >= cutoff24m) last24m += amount;

      // Monthly chart (last 13 months)
      if (entryDate >= cutoffDate(13)) {
        const key = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, "0")}`;
        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + amount);
      }

      // By category
      byCategoryMap.set(asset.type, (byCategoryMap.get(asset.type) ?? 0) + amount);

      // Last dividend
      if (!lastDividendDate || entryDate > new Date(lastDividendDate)) {
        lastDividendDate = e.date.toISOString();
        lastDividendAmount = amount;
      }
    }

    const yieldOnCost =
      totalQty > 0 && avgCost > 0 ? (div12m / (totalQty * avgCost)) * 100 : 0;

    // DY from brapi (only for eligible tickers)
    let dy: number | null = null;
    if (asset.ticker && BRAPI_ELIGIBLE.includes(asset.type as string)) {
      const cashDivs = await fetchDividends(asset.ticker);
      if (cashDivs) {
        const sum12m = cashDivs
          .filter((d) => new Date(d.paymentDate) >= cutoff12m)
          .reduce((s, d) => s + d.rate, 0);
        const currentPrice = asset.currentPrice ? toNumber(asset.currentPrice) : 0;
        dy = currentPrice > 0 ? (sum12m / currentPrice) * 100 : null;
      }
    }

    proventosAssets.push({
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      type: asset.type,
      totalQuantity: totalQty,
      avgCost,
      totalDividends: assetTotalDivs,
      lastDividendDate,
      lastDividendAmount,
      yieldOnCost,
      dy,
    });
  }

  // Build monthly array (last 13 months, sorted)
  const monthly = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amount }));

  // Build byCategory array
  const byCategory = [...byCategoryMap.entries()].map(([type, amount]) => ({
    type: type as ProventosData["byCategory"][number]["type"],
    amount,
  }));

  // Sort assets by totalDividends desc
  proventosAssets.sort((a, b) => b.totalDividends - a.totalDividends);

  const response: ProventosData = {
    totalReceived,
    last6m,
    last12m,
    last24m,
    monthly,
    byCategory,
    assets: proventosAssets,
  };

  return NextResponse.json(response);
}

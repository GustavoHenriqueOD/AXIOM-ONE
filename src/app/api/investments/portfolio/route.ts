import { toNumber } from "@/lib/utils";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AssetType } from "@/generated/prisma/client";
import { fetchQuotes } from "@/lib/quotes";
import { fetchBenchmarks } from "@/lib/benchmarks";
import { fetchCryptoPrices } from "@/lib/crypto";

export interface AssetPosition {
  id: string;
  name: string;
  ticker: string | null;
  type: AssetType;
  currency: string;
  totalQuantity: number;
  avgCost: number;
  currentPrice: number;
  totalInvested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  totalDividends: number;
  priceSource: "live" | "manual";
  dailyChangeAmount: number;
  dailyChangePct: number;
  monthlyYield: number | null;
  indexer: string | null;
  rate: number | null;
}

const FIXED_INCOME_TYPES = new Set([
  "CDB", "RDB", "LCI", "LCA", "TESOURO", "POUPANCA", "FIXED_INCOME",
]);

function calcMonthlyYield(
  currentValue: number,
  indexer: string | null,
  rate: number | null,
  selicAnual: number
): number | null {
  if (currentValue <= 0 || !indexer) return null;
  const r = rate ?? 100;
  let annualYield: number;
  if (indexer === "POUPANCA") {
    annualYield = selicAnual > 8.5 ? selicAnual * 0.7 : 6.0;
  } else if (indexer === "PREFIXADO") {
    annualYield = r;
  } else {
    // CDI or SELIC
    annualYield = (r / 100) * selicAnual;
  }
  const monthlyFactor = Math.pow(1 + annualYield / 100, 1 / 12) - 1;
  return currentValue * monthlyFactor;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assets = await prisma.asset.findMany({
    where: { userId: session.user.id },
    include: { entries: { orderBy: { date: "asc" } } },
  });

  // Separate B3 tickers from crypto coingeckoIds
  const b3Tickers = assets
    .filter((a) => a.ticker && a.type !== "CRYPTO")
    .map((a) => a.ticker!);
  const cryptoAssets = assets.filter((a) => a.ticker && a.type === "CRYPTO");
  const cryptoIds = cryptoAssets.map((a) => a.ticker!);

  // Fetch all market data in parallel
  const [liveQuoteMap, benchmarks, cryptoPriceMap] = await Promise.all([
    fetchQuotes(b3Tickers),
    fetchBenchmarks(),
    fetchCryptoPrices(cryptoIds),
  ]);

  const selicAnual = benchmarks.selicAnual ?? 10.5;

  const positions: AssetPosition[] = assets.map((asset) => {
    let totalQty = 0;
    let totalCost = 0;
    let totalDividends = 0;

    for (const e of asset.entries) {
      const qty = toNumber(e.quantity);
      const price = toNumber(e.price);
      const amount = toNumber(e.amount);

      if (e.type === "PURCHASE") {
        totalCost += qty * price;
        totalQty += qty;
      } else if (e.type === "SALE") {
        if (totalQty > 0) {
          const avgCostNow = totalCost / totalQty;
          totalCost -= qty * avgCostNow;
        }
        totalQty -= qty;
      } else if (e.type === "DIVIDEND") {
        totalDividends += amount;
      } else if (e.type === "SPLIT") {
        totalQty = qty;
      }
    }

    if (totalQty < 0.000001) totalQty = 0;

    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    // Resolve current price: crypto → CoinGecko, B3 → brapi, fallback → DB
    let currentPrice: number;
    let priceSource: "live" | "manual";
    let dailyChangePct = 0;
    let dailyChangeAmount = 0;

    if (asset.type === "CRYPTO" && asset.ticker && cryptoPriceMap[asset.ticker] != null) {
      currentPrice = cryptoPriceMap[asset.ticker];
      priceSource = "live";
    } else if (asset.type !== "CRYPTO" && asset.ticker && liveQuoteMap[asset.ticker]) {
      const liveQuote = liveQuoteMap[asset.ticker];
      currentPrice = liveQuote.price;
      priceSource = "live";
      dailyChangePct = liveQuote.dailyChangePct ?? 0;
      dailyChangeAmount = liveQuote.dailyChange ? totalQty * liveQuote.dailyChange : 0;
    } else {
      currentPrice = asset.currentPrice ? toNumber(asset.currentPrice) : avgCost;
      priceSource = "manual";
    }

    const totalInvested = totalQty * avgCost;
    const currentValue = totalQty * currentPrice;
    const pnl = currentValue - totalInvested;
    const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

    const assetIndexer = asset.indexer ?? null;
    const assetRate = asset.rate ? toNumber(asset.rate) : null;
    const monthlyYield = FIXED_INCOME_TYPES.has(asset.type)
      ? calcMonthlyYield(currentValue, assetIndexer, assetRate, selicAnual)
      : null;

    return {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      type: asset.type,
      currency: asset.currency,
      totalQuantity: totalQty,
      avgCost,
      currentPrice,
      totalInvested,
      currentValue,
      pnl,
      pnlPct,
      totalDividends,
      priceSource,
      dailyChangeAmount,
      dailyChangePct,
      monthlyYield,
      indexer: assetIndexer,
      rate: assetRate,
    };
  });

  // Keep assets with active position OR freshly registered (no entries)
  const assetsWithEntries = new Set(assets.filter((a) => a.entries.length > 0).map((a) => a.id));
  const activePositions = positions.filter((p) => p.totalQuantity > 0 || !assetsWithEntries.has(p.id));

  // Fire-and-forget: update currentPrice in DB for live-priced assets
  const updates = activePositions
    .filter((p) => p.priceSource === "live" && p.ticker)
    .map((p) =>
      prisma.asset.update({
        where: { id: p.id },
        data: { currentPrice: p.currentPrice },
      })
    );
  Promise.all(updates).catch(() => {});

  const totalInvested = activePositions.reduce((acc, p) => acc + p.totalInvested, 0);
  const totalCurrentValue = activePositions.reduce((acc, p) => acc + p.currentValue, 0);
  const totalPnl = totalCurrentValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Allocation by type
  const allocationByType: Partial<Record<AssetType, number>> = {};
  for (const p of activePositions) {
    allocationByType[p.type] = (allocationByType[p.type] ?? 0) + p.currentValue;
  }
  if (totalCurrentValue > 0) {
    for (const key of Object.keys(allocationByType) as AssetType[]) {
      allocationByType[key] = ((allocationByType[key] ?? 0) / totalCurrentValue) * 100;
    }
  }

  return NextResponse.json({
    assets: activePositions,
    totals: { totalInvested, totalCurrentValue, totalPnl, totalPnlPct },
    allocationByType,
  });
}

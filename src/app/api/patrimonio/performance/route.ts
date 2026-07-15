import { toNumber } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache";

export type Period = "1y" | "2y" | "5y" | "all";

export interface PerformancePoint {
  month: string;         // "jan/25"
  portfolio: number;     // cumulative % return from first month
  cdi: number | null;    // cumulative % return
  ipca: number | null;   // cumulative % return
  ibov: number | null;   // cumulative % return (null if no BRAPI_TOKEN)
}

export interface PerformanceResponse {
  points: PerformancePoint[];
  period: Period;
  hasIbov: boolean;
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS_PT[month - 1]}/${String(year).slice(-2)}`;
}

function bcbFmt(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// BCB SGS série 12 — taxa SELIC/CDI diária → compõe em mensal
async function fetchCdiMonthly(startDate: Date, endDate: Date): Promise<Map<string, number>> {
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${bcbFmt(startDate)}&dataFinal=${bcbFmt(endDate)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return new Map();

    const data: { data: string; valor: string }[] = await res.json();
    const byMonth = new Map<string, number[]>();

    for (const row of data) {
      const parts = row.data.split("/"); // DD/MM/YYYY
      const key = `${parts[2]}-${parts[1]}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(parseFloat(row.valor) / 100);
    }

    const monthly = new Map<string, number>();
    for (const [key, rates] of byMonth) {
      let compound = 1;
      for (const r of rates) compound *= 1 + r;
      monthly.set(key, compound - 1);
    }
    return monthly;
  } catch {
    return new Map();
  }
}

// BCB SGS série 433 — IPCA mensal
async function fetchIpcaMonthly(startDate: Date, endDate: Date): Promise<Map<string, number>> {
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=${bcbFmt(startDate)}&dataFinal=${bcbFmt(endDate)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return new Map();

    const data: { data: string; valor: string }[] = await res.json();
    const monthly = new Map<string, number>();
    for (const row of data) {
      const parts = row.data.split("/");
      const key = `${parts[2]}-${parts[1]}`;
      monthly.set(key, parseFloat(row.valor) / 100);
    }
    return monthly;
  } catch {
    return new Map();
  }
}

// BRAPI — IBOV histórico mensal
async function fetchIbovMonthly(yearsBack: number): Promise<Map<string, number> | null> {
  const token = process.env.BRAPI_TOKEN;
  if (!token) return null;

  try {
    const range = yearsBack <= 1 ? "1y" : yearsBack <= 2 ? "2y" : yearsBack <= 5 ? "5y" : "max";
    const url = `https://brapi.dev/api/quote/IBOV?range=${range}&interval=1mo&token=${token}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const json = await res.json();
    const history = json?.results?.[0]?.historicalDataPrice as
      | Array<{ date: number; close: number }>
      | undefined;
    if (!history?.length) return null;

    const monthly = new Map<string, number>();
    for (const point of history) {
      // BRAPI returns Unix timestamp in seconds
      const d = new Date(point.date * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthly.set(key, point.close);
    }
    return monthly;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = (req.nextUrl.searchParams.get("period") ?? "all") as Period;

  // 1. Construir série mensal do patrimônio do usuário
  const allTx = await prisma.transaction.findMany({
    where: { userId: session.user.id },
    orderBy: { date: "asc" },
    select: { amount: true, type: true, date: true },
  });

  if (allTx.length === 0) {
    return NextResponse.json({ points: [], period, hasIbov: false } satisfies PerformanceResponse);
  }

  const now = new Date();
  const firstDate = allTx[0].date;

  // Gera keys de todos os meses desde a primeira transação
  const allMonthKeys: string[] = [];
  let cur = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  while (cur <= now) {
    allMonthKeys.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`
    );
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  // Calcula patrimônio acumulado por mês
  let cumulative = 0;
  const portfolioByMonth = new Map<string, number>();
  for (const key of allMonthKeys) {
    const [y, m] = key.split("-").map(Number);
    for (const t of allTx) {
      if (t.date.getFullYear() === y && t.date.getMonth() + 1 === m) {
        const amt = toNumber(t.amount);
        cumulative += t.type === "INCOME" ? amt : -amt;
      }
    }
    portfolioByMonth.set(key, cumulative);
  }

  // Aplica filtro de período
  let filteredKeys = allMonthKeys;
  if (period !== "all") {
    const yearsBack = period === "1y" ? 1 : period === "2y" ? 2 : 5;
    const cutoff = new Date(now.getFullYear() - yearsBack, now.getMonth(), 1);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
    const filtered = allMonthKeys.filter((k) => k >= cutoffKey);
    if (filtered.length >= 2) filteredKeys = filtered;
  }

  if (filteredKeys.length < 2) {
    return NextResponse.json({ points: [], period, hasIbov: false } satisfies PerformanceResponse);
  }

  const startKey = filteredKeys[0];
  const startDate = new Date(startKey + "-01");
  const yearsBack = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
  const yearsBackNum = Math.ceil(yearsBack / 12) + 1;

  // 2. Buscar dados externos (com cache 4h)
  const [cdiMap, ipcaMap, ibovMap] = await Promise.all([
    cached(`cdi-monthly-${startKey}`, 4 * 60 * 60 * 1000, () => fetchCdiMonthly(startDate, now)),
    cached(`ipca-monthly-${startKey}`, 4 * 60 * 60 * 1000, () => fetchIpcaMonthly(startDate, now)),
    cached(`ibov-monthly-${startKey}`, 4 * 60 * 60 * 1000, () => fetchIbovMonthly(yearsBackNum)),
  ]);

  // 3. Normalizar para % de retorno acumulado a partir do mês base
  const basePortfolio = portfolioByMonth.get(startKey) ?? 0;

  // IBOV: preço base no primeiro mês (ou o mais próximo disponível)
  let ibovBase: number | null = null;
  if (ibovMap && ibovMap.size > 0) {
    ibovBase = ibovMap.get(startKey) ?? null;
    if (!ibovBase) {
      // Busca o primeiro preço disponível a partir de startKey
      for (const [k, v] of [...ibovMap.entries()].sort()) {
        if (k >= startKey) { ibovBase = v; break; }
      }
    }
  }

  let cdiCompound = 1;
  let ipcaCompound = 1;

  const points: PerformancePoint[] = filteredKeys.map((key, i) => {
    // Para meses após o primeiro, acumula taxa do mês anterior
    if (i > 0) {
      const prevKey = filteredKeys[i - 1];
      const cdiRate = cdiMap.get(prevKey);
      if (cdiRate !== undefined) cdiCompound *= 1 + cdiRate;
      const ipcaRate = ipcaMap.get(prevKey);
      if (ipcaRate !== undefined) ipcaCompound *= 1 + ipcaRate;
    }

    const portfolio =
      basePortfolio !== 0
        ? ((portfolioByMonth.get(key)! - basePortfolio) / Math.abs(basePortfolio)) * 100
        : 0;

    const cdi = cdiMap.size > 0 ? (cdiCompound - 1) * 100 : null;
    const ipca = ipcaMap.size > 0 ? (ipcaCompound - 1) * 100 : null;

    let ibov: number | null = null;
    if (ibovMap && ibovBase) {
      const price = ibovMap.get(key);
      if (price) ibov = ((price - ibovBase) / ibovBase) * 100;
    }

    return { month: monthLabel(key), portfolio, cdi, ipca, ibov };
  });

  const hasIbov = ibovMap !== null && ibovMap.size > 0 && points.some((p) => p.ibov !== null);

  return NextResponse.json({ points, period, hasIbov } satisfies PerformanceResponse);
}

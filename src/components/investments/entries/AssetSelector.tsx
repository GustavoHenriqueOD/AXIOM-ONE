"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, X } from "lucide-react";
import type { AssetType } from "@/generated/prisma/client";

export const ASSET_TYPES_GROUPED: AssetType[] = [
  "CDB", "RDB", "LCI", "LCA", "TESOURO", "POUPANCA", "FIXED_INCOME",
  "STOCK", "FII", "ETF", "BDR", "STOCK_INT", "CRYPTO", "OTHER",
];

export const FIXED_INCOME_ASSET_TYPES = new Set<AssetType>([
  "CDB", "RDB", "LCI", "LCA", "TESOURO", "POUPANCA", "FIXED_INCOME",
]);

export const TYPE_BADGE: Partial<Record<AssetType, string>> = {
  STOCK: "Ação", FII: "FII", ETF: "ETF", BDR: "BDR",
  CRYPTO: "Crypto", FIXED_INCOME: "RF", STOCK_INT: "Int'l",
  CDB: "CDB", RDB: "RDB", LCI: "LCI", LCA: "LCA",
  TESOURO: "Tesouro", POUPANCA: "Poup.", OTHER: "Outro",
};

export type AssetMode = "existing" | "new" | "ticker";

export interface AssetRaw {
  id: string;
  name: string;
  ticker: string | null;
  type: AssetType;
  currency: string;
  currentPrice: number | null;
}

export interface TickerSuggestion {
  ticker: string;
  name: string;
  price: number | null;
  assetType: AssetType;
  currency: string;
}

interface CryptoSuggestion {
  id: string;
  name: string;
  symbol: string;
}

export interface NewAssetConfig {
  name: string;
  type: AssetType;
  indexer?: string;
  rate?: number;
  ticker?: string;
}

interface AssetSelectorProps {
  assets: AssetRaw[];
  defaultAssetId?: string;
  onSelect: (assetId: string, currentPrice?: number | null) => void;
  onModeChange: (mode: "existing" | "new") => void;
  onNewAssetConfigured: (config: NewAssetConfig) => void;
  onNewAsset?: (asset: AssetRaw) => void;
  onCreatingTickerChange?: (loading: boolean) => void;
}

export function AssetSelector({
  assets,
  defaultAssetId,
  onSelect,
  onModeChange,
  onNewAssetConfigured,
  onNewAsset,
  onCreatingTickerChange,
}: AssetSelectorProps) {
  const t = useTranslations("Investments");

  const defaultAsset = assets.find((a) => a.id === defaultAssetId);
  const defaultLabel = defaultAsset
    ? defaultAsset.ticker
      ? `${defaultAsset.ticker} — ${defaultAsset.name}`
      : defaultAsset.name
    : "";

  const [assetMode, setAssetMode] = useState<AssetMode>("existing");
  const [assetSearch, setAssetSearch] = useState(defaultLabel);
  const [showDropdown, setShowDropdown] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetType, setNewAssetType] = useState<AssetType>("CDB");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Ticker search state
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerSuggestions, setTickerSuggestions] = useState<TickerSuggestion[]>([]);
  const [tickerSearching, setTickerSearching] = useState(false);
  const [showTickerSuggestions, setShowTickerSuggestions] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);

  // Renda fixa extra fields — kept here to build NewAssetConfig
  const [indexer, setIndexer] = useState("CDI");
  const [rate, setRate] = useState("");

  // Crypto search state
  const [cryptoSearch, setCryptoSearch] = useState("");
  const [cryptoResults, setCryptoResults] = useState<CryptoSuggestion[]>([]);
  const [cryptoSearching, setCryptoSearching] = useState(false);
  const [showCryptoDropdown, setShowCryptoDropdown] = useState(false);
  const [selectedCryptoId, setSelectedCryptoId] = useState<string | null>(null);
  const cryptoRef = useRef<HTMLDivElement>(null);

  const [creatingTicker, setCreatingTicker] = useState(false);

  // Filtered assets for dropdown
  const filteredAssets = useMemo(
    () => assets.filter((a) =>
      a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
      (a.ticker ?? "").toLowerCase().includes(assetSearch.toLowerCase())
    ),
    [assets, assetSearch]
  );

  // Notify parent about mode changes
  useEffect(() => {
    onModeChange(assetMode === "ticker" ? "existing" : assetMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode]);

  // Notify parent about new asset config whenever relevant fields change
  useEffect(() => {
    if (assetMode !== "new") return;
    const resolvedIndexer =
      newAssetType === "POUPANCA"
        ? "POUPANCA"
        : FIXED_INCOME_ASSET_TYPES.has(newAssetType)
        ? indexer
        : undefined;
    const resolvedRate =
      newAssetType === "POUPANCA" || !FIXED_INCOME_ASSET_TYPES.has(newAssetType)
        ? undefined
        : rate
        ? parseFloat(rate)
        : undefined;
    const resolvedTicker =
      newAssetType === "CRYPTO" && selectedCryptoId ? selectedCryptoId : undefined;

    onNewAssetConfigured({
      name: newAssetName.trim(),
      type: newAssetType,
      indexer: resolvedIndexer,
      rate: resolvedRate,
      ticker: resolvedTicker,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode, newAssetName, newAssetType, indexer, rate, selectedCryptoId]);

  // Notify parent about creatingTicker
  useEffect(() => {
    onCreatingTickerChange?.(creatingTicker);
  }, [creatingTicker, onCreatingTickerChange]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (tickerRef.current && !tickerRef.current.contains(e.target as Node)) {
        setShowTickerSuggestions(false);
      }
      if (cryptoRef.current && !cryptoRef.current.contains(e.target as Node)) {
        setShowCryptoDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Ticker search debounce
  const fetchTickerSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setTickerSuggestions([]); setShowTickerSuggestions(false); return; }
    setTickerSearching(true);
    try {
      const res = await fetch(`/api/investments/ticker-search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setTickerSuggestions(data);
        setShowTickerSuggestions(true);
      }
    } finally {
      setTickerSearching(false);
    }
  }, []);

  useEffect(() => {
    if (assetMode !== "ticker") return;
    const timer = setTimeout(() => fetchTickerSuggestions(tickerSearch), 300);
    return () => clearTimeout(timer);
  }, [tickerSearch, assetMode, fetchTickerSuggestions]);

  // Crypto search debounce
  useEffect(() => {
    if (assetMode !== "new" || newAssetType !== "CRYPTO") return;
    if (cryptoSearch.length < 2) { setCryptoResults([]); setShowCryptoDropdown(false); return; }
    const timer = setTimeout(async () => {
      setCryptoSearching(true);
      try {
        const res = await fetch(`/api/investments/crypto-search?q=${encodeURIComponent(cryptoSearch)}`);
        if (res.ok) {
          const data = await res.json();
          setCryptoResults(data);
          setShowCryptoDropdown(true);
        }
      } finally {
        setCryptoSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [cryptoSearch, assetMode, newAssetType]);

  function selectExistingAsset(a: AssetRaw) {
    setAssetSearch(a.ticker ? `${a.ticker} — ${a.name}` : a.name);
    setShowDropdown(false);
    setAssetMode("existing");
    onSelect(a.id, a.currentPrice);
  }

  function enterNewAssetMode(name: string) {
    setNewAssetName(name);
    setAssetMode("new");
    setShowDropdown(false);
  }

  async function selectTickerSuggestion(s: TickerSuggestion) {
    setShowTickerSuggestions(false);
    setTickerSearch("");

    // Check if asset already exists in the list
    const existing = assets.find((a) => a.ticker === s.ticker);
    if (existing) {
      selectExistingAsset(existing);
      return;
    }

    // Create asset via POST /api/investments/assets
    setCreatingTicker(true);
    try {
      const res = await fetch("/api/investments/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name,
          ticker: s.ticker,
          type: s.assetType,
          currency: s.currency,
          currentPrice: s.price,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        onNewAsset?.(created);
        setAssetSearch(`${s.ticker} — ${s.name}`);
        setAssetMode("existing");
        onSelect(created.id, s.price);
      }
    } finally {
      setCreatingTicker(false);
    }
  }

  const selectedAssetLabel = assetMode === "new"
    ? newAssetName
    : assetMode === "ticker"
    ? ""
    : assetSearch;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-axiom-muted text-sm">{t("table.asset")} *</Label>

      {/* Modo existing: combobox filtrado */}
      {assetMode !== "ticker" && (
        <div className="relative" ref={dropdownRef}>
          <Input
            value={assetMode === "new" ? "" : selectedAssetLabel}
            onChange={(e) => {
              setAssetSearch(e.target.value);
              onSelect("", null);
              setAssetMode("existing");
              setShowDropdown(true);
            }}
            onFocus={() => { if (assetMode !== "new") setShowDropdown(true); }}
            placeholder={assetMode === "new" ? "Nome do ativo definido abaixo" : "Buscar ativo ou digitar nome..."}
            readOnly={assetMode === "new"}
            className="bg-axiom-bg border-axiom-border text-white"
          />
          {showDropdown && assetMode !== "new" && (
            <div className="absolute z-50 w-full mt-1 bg-axiom-card border border-axiom-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
              {filteredAssets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => selectExistingAsset(a)}
                  className="w-full text-left px-3 py-2 text-sm text-white hover:bg-axiom-hover flex items-center gap-2"
                >
                  <span className="text-axiom-muted text-xs bg-axiom-hover px-1.5 py-0.5 rounded shrink-0">
                    {TYPE_BADGE[a.type] ?? a.type}
                  </span>
                  <span className="truncate">{a.ticker ? `${a.ticker} — ` : ""}{a.name}</span>
                </button>
              ))}
              {assetSearch.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => enterNewAssetMode(assetSearch.trim())}
                  className="w-full text-left px-3 py-2 text-sm text-axiom-primary hover:bg-axiom-hover border-t border-axiom-border"
                >
                  + Criar &quot;{assetSearch.trim()}&quot; como novo ativo
                </button>
              )}
              {filteredAssets.length === 0 && assetSearch.trim().length === 0 && (
                <p className="px-3 py-2 text-xs text-axiom-muted">Nenhum ativo cadastrado ainda</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modo new: nome fixo + select de tipo */}
      {assetMode === "new" && (
        <div className="flex items-center gap-2 bg-axiom-bg border border-axiom-border rounded-lg px-3 py-2">
          <span className="text-sm text-white flex-1 truncate">{newAssetName}</span>
          <Select value={newAssetType} onValueChange={(v) => setNewAssetType(v as AssetType)}>
            <SelectTrigger className="w-36 bg-axiom-hover border-axiom-border text-white text-xs h-7">
              <SelectValue>{t(`assetTypes.${newAssetType}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-axiom-card border-axiom-border">
              {ASSET_TYPES_GROUPED.map((at) => (
                <SelectItem key={at} value={at} className="text-white hover:bg-axiom-hover text-xs">
                  {t(`assetTypes.${at}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => { setAssetMode("existing"); setAssetSearch(""); onSelect("", null); }}
            className="text-axiom-muted hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Modo ticker: pesquisa na B3/Cripto */}
      {assetMode === "ticker" && (
        <div className="relative" ref={tickerRef}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-axiom-muted" />
            <Input
              value={tickerSearch}
              onChange={(e) => setTickerSearch(e.target.value)}
              placeholder="Ex: PETR4, MXRF11, BTC..."
              className="bg-axiom-bg border-axiom-border text-white pl-8 pr-8"
              autoFocus
            />
            {tickerSearching || creatingTicker ? (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-axiom-muted" />
            ) : (
              <button
                type="button"
                onClick={() => { setAssetMode("existing"); setTickerSearch(""); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-axiom-muted hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {showTickerSuggestions && tickerSuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-axiom-card border border-axiom-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
              {tickerSuggestions.map((s) => (
                <button
                  key={s.ticker}
                  type="button"
                  onClick={() => selectTickerSuggestion(s)}
                  className="w-full text-left px-3 py-2 text-sm text-white hover:bg-axiom-hover flex justify-between items-center"
                >
                  <span>{s.ticker} — {s.name}</span>
                  {s.price != null && (
                    <span className="text-axiom-muted text-xs">R$ {s.price.toFixed(2)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Campos dinâmicos — Renda Fixa */}
      {assetMode === "new" && FIXED_INCOME_ASSET_TYPES.has(newAssetType) && newAssetType !== "POUPANCA" && (
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div className="flex flex-col gap-1">
            <Label className="text-axiom-muted text-xs">Indexador</Label>
            <Select value={indexer} onValueChange={(v) => v && setIndexer(v)}>
              <SelectTrigger className="bg-axiom-bg border-axiom-border text-white text-sm">
                <SelectValue>{indexer}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-axiom-card border-axiom-border">
                {["CDI", "SELIC", "PREFIXADO"].map((idx) => (
                  <SelectItem key={idx} value={idx} className="text-white hover:bg-axiom-hover text-sm">
                    {idx}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-axiom-muted text-xs">Taxa (% a.a.)</Label>
            <Input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              type="number"
              step="0.01"
              min="0"
              placeholder="100 para 100% CDI"
              className="bg-axiom-bg border-axiom-border text-white"
            />
          </div>
        </div>
      )}

      {/* Badge informativo — Poupança */}
      {assetMode === "new" && newAssetType === "POUPANCA" && (
        <p className="text-xs text-axiom-muted bg-axiom-bg border border-axiom-border rounded-lg px-3 py-2 mt-1">
          Taxa automática pela SELIC
        </p>
      )}

      {/* Campos dinâmicos — Crypto */}
      {assetMode === "new" && newAssetType === "CRYPTO" && (
        <div className="flex flex-col gap-1 mt-1" ref={cryptoRef}>
          <Label className="text-axiom-muted text-xs">Símbolo da cripto</Label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-axiom-muted" />
            <Input
              value={cryptoSearch}
              onChange={(e) => { setCryptoSearch(e.target.value); setSelectedCryptoId(null); }}
              placeholder="Ex: BTC, ETH, SOL..."
              className="bg-axiom-bg border-axiom-border text-white pl-8 pr-8"
            />
            {cryptoSearching && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-axiom-muted" />
            )}
            {selectedCryptoId && !cryptoSearching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-axiom-income text-xs">✓</span>
            )}
          </div>
          {showCryptoDropdown && cryptoResults.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-axiom-card border border-axiom-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {cryptoResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCryptoId(c.id);
                    setCryptoSearch(`${c.symbol} — ${c.name}`);
                    setShowCryptoDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-white hover:bg-axiom-hover flex justify-between items-center"
                >
                  <span className="font-medium">{c.symbol}</span>
                  <span className="text-axiom-muted text-xs truncate ml-2">{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toggle pesquisa B3 */}
      <button
        type="button"
        onClick={() => setAssetMode(assetMode === "ticker" ? "existing" : "ticker")}
        className="text-axiom-primary text-xs hover:underline flex items-center gap-1 w-fit"
      >
        <Search size={11} />
        {assetMode === "ticker" ? t("cancelTickerSearch") : t("tickerSearchToggle")}
      </button>
    </div>
  );
}

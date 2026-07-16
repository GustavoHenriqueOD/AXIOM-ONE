"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssetSelector } from "./AssetSelector";
import type { AssetRaw, AssetMode, NewAssetConfig } from "./AssetSelector";
import type { EntryType } from "@/generated/prisma/client";

const ENTRY_TYPES: EntryType[] = ["PURCHASE", "SALE", "DIVIDEND", "SPLIT"];

interface EntryForm {
  id?: string;
  assetId?: string;
  type?: EntryType;
  date?: string;
  quantity?: number;
  price?: number;
  notes?: string | null;
}

interface EntryDialogProps {
  open: boolean;
  onClose: () => void;
  entry?: EntryForm | null;
  assets: AssetRaw[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (entry: any) => void;
  onNewAsset?: (asset: AssetRaw) => void;
}

export function EntryDialog({ open, onClose, entry, assets, onSave, onNewAsset }: EntryDialogProps) {
  const t = useTranslations("Investments");

  // Asset selection (resolved via AssetSelector callbacks)
  const [assetId, setAssetId] = useState("");
  const [assetMode, setAssetMode] = useState<AssetMode>("existing");
  const [newAssetConfig, setNewAssetConfig] = useState<NewAssetConfig>({ name: "", type: "CDB" });
  const [creatingTicker, setCreatingTicker] = useState(false);

  // Entry fields
  const [type, setType] = useState<EntryType>("PURCHASE");
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isSplit = type === "SPLIT";
  const total = !isSplit && quantity && price ? (Number(quantity) * Number(price)).toFixed(2) : null;

  // Default values for AssetSelector — recomputed on open
  const defaultAssetId = open ? (entry?.assetId ?? (assets[0]?.id ?? "")) : undefined;

  // Reset entry fields on open (AssetSelector resets via key prop)
  useEffect(() => {
    if (open) {
      const defaultAsset = assets.find((a) => a.id === defaultAssetId);

      setAssetId(defaultAssetId ?? "");
      setAssetMode("existing");
      setNewAssetConfig({ name: "", type: "CDB" });
      setCreatingTicker(false);

      setType(entry?.type ?? "PURCHASE");
      setDate(entry?.date ? entry.date.substring(0, 10) : new Date().toISOString().substring(0, 10));
      setQuantity(entry?.quantity != null ? String(entry.quantity) : "");
      if (entry?.price != null) {
        setPrice(String(entry.price));
      } else {
        setPrice(defaultAsset?.currentPrice != null ? String(defaultAsset.currentPrice) : "");
      }
      setNotes(entry?.notes ?? "");
      setError("");
    }
  }, [open, entry, assets, defaultAssetId]);

  async function handleSave() {
    if (assetMode === "existing" && !assetId) { setError("Selecione ou crie um ativo"); return; }
    if (assetMode === "new" && !newAssetConfig.name.trim()) { setError("Nome do ativo obrigatório"); return; }
    if (!quantity || Number(quantity) <= 0) { setError("Quantidade deve ser maior que zero"); return; }
    if (!isSplit && (!price || Number(price) <= 0)) { setError("Preço deve ser maior que zero"); return; }

    setSaving(true);
    setError("");
    try {
      const base = {
        type,
        date,
        quantity: Number(quantity),
        price: isSplit ? 0 : Number(price),
        notes: notes || null,
      };

      const body = assetMode === "new"
        ? { ...base, assetId: null, newAsset: newAssetConfig }
        : { ...base, assetId };

      const url = entry?.id ? `/api/investments/entries/${entry.id}` : "/api/investments/entries";
      const method = entry?.id ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erro ao salvar"); return; }
      onSave(data);
      onClose();
    } catch {
      setError("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-axiom-card border-axiom-border text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry?.id ? t("dialog.editEntry") : t("dialog.newEntry")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">

          {/* ── Campo Ativo ── */}
          <AssetSelector
            key={open ? "open" : "closed"}
            assets={assets}
            defaultAssetId={defaultAssetId}
            onSelect={(id, currentPrice) => {
              setAssetId(id);
              if (currentPrice != null) setPrice(String(currentPrice));
            }}
            onModeChange={(mode) => {
              setAssetMode(mode);
              if (mode === "new") setType("PURCHASE");
            }}
            onNewAssetConfigured={setNewAssetConfig}
            onNewAsset={onNewAsset}
            onCreatingTickerChange={setCreatingTicker}
          />

          {/* ── Tipo + Data ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-axiom-muted text-sm">Tipo *</Label>
              <Select value={type} onValueChange={(v) => setType(v as EntryType)}>
                <SelectTrigger className="bg-axiom-bg border-axiom-border text-white">
                  <SelectValue>{t(`entryTypes.${type}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-axiom-card border-axiom-border">
                  {ENTRY_TYPES.map((et) => (
                    <SelectItem
                      key={et}
                      value={et}
                      disabled={assetMode === "new" && et !== "PURCHASE"}
                      className="text-white hover:bg-axiom-hover disabled:opacity-40"
                    >
                      {t(`entryTypes.${et}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-axiom-muted text-sm">Data *</Label>
              <Input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="bg-axiom-bg border-axiom-border text-white"
              />
            </div>
          </div>

          {/* ── Quantidade + Preço ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-axiom-muted text-sm">
                {isSplit ? "Novo Total de Cotas *" : `${t("table.quantity")} *`}
              </Label>
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                type="number"
                step="0.000001"
                min="0"
                placeholder="0"
                className="bg-axiom-bg border-axiom-border text-white"
              />
            </div>
            {!isSplit && (
              <div className="flex flex-col gap-1">
                <Label className="text-axiom-muted text-sm">{t("table.price")} *</Label>
                <Input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  className="bg-axiom-bg border-axiom-border text-white"
                />
              </div>
            )}
          </div>

          {/* ── Total ── */}
          {total && (
            <div className="bg-axiom-bg rounded-lg px-4 py-2 flex justify-between items-center">
              <span className="text-axiom-muted text-sm">{t("table.total")}</span>
              <span className="text-white font-semibold">R$ {total}</span>
            </div>
          )}

          {/* ── Notas ── */}
          <div className="flex flex-col gap-1">
            <Label className="text-axiom-muted text-sm">{t("table.notes")}</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações..."
              className="bg-axiom-bg border-axiom-border text-white"
            />
          </div>

          {error && <p className="text-axiom-expense text-sm">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="border-axiom-border text-axiom-muted hover:text-white">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || creatingTicker}
              className="bg-axiom-primary text-white hover:opacity-90"
            >
              {saving || creatingTicker ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

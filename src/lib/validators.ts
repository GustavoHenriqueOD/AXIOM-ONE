import { toNumber } from "./utils";

export function validateAmount(val: unknown): number | null {
  const n = toNumber(val);
  return n > 0 ? n : null;
}

export function validateDate(val: unknown): Date | null {
  if (!val) return null;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
}

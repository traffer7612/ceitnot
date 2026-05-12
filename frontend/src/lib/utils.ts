import { formatUnits } from 'viem';

export const WAD         = 10n ** 18n;
export const MAX_UINT256 = 2n ** 256n - 1n;

/** ERC-20 `decimals()` as number (OZ returns uint8; viem may surface bigint). */
export function erc20Decimals(d: number | bigint | undefined, fallback = 18): number {
  if (d === undefined) return fallback;
  return typeof d === 'bigint' ? Number(d) : d;
}

/** Format a WAD (1e18) bigint as a human number string */
export function formatWad(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return '—';
  return Number(formatUnits(v, 18)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Format any token with its decimals (`locale` e.g. `'en-US'` avoids comma decimals in RU locale). */
export function formatToken(
  v: bigint | undefined,
  decimals = 18,
  dp = 4,
  locale?: string | string[],
): string {
  if (v === undefined) return '—';
  return Number(formatUnits(v, decimals)).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Format basis points as "X.XX%" */
export function formatBps(bps: bigint | undefined, dp = 2): string {
  if (bps === undefined) return '—';
  return (Number(bps) / 100).toFixed(dp) + '%';
}

/** Format a RAY fraction as % (used for IRM params in market config): 0.8e27 -> "80.00%" */
export function formatRate(v: bigint | undefined): string {
  if (v === undefined) return '—';
  return (Number(formatUnits(v, 27)) * 100).toFixed(2) + '%';
}

/** Shorten "0x1234…5678" */
export function formatAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Parse WAD health factor bigint → JS number (Infinity when no debt) */
export function parseHf(v: bigint | undefined): number {
  if (v === undefined) return Infinity;
  if (v >= MAX_UINT256 - WAD) return Infinity;
  return Number(formatUnits(v, 18));
}

/** Display string for health factor */
export function formatHf(v: bigint | undefined): string {
  const hf = parseHf(v);
  return isFinite(hf) ? hf.toFixed(2) : '∞';
}

/** Tailwind text color class for a health factor number */
export function hfColor(hf: number): string {
  if (!isFinite(hf) || hf >= 2.0) return 'text-ceitnot-success';
  if (hf >= 1.5)                   return 'text-emerald-400';
  if (hf >= 1.2)                   return 'text-ceitnot-warning';
  if (hf >= 1.0)                   return 'text-orange-400';
  return 'text-ceitnot-danger';
}

/** Tailwind bg color class for HF bar fill */
export function hfBarColor(hf: number): string {
  if (!isFinite(hf) || hf >= 2.0) return 'bg-ceitnot-success';
  if (hf >= 1.5)                   return 'bg-emerald-400';
  if (hf >= 1.2)                   return 'bg-ceitnot-warning';
  if (hf >= 1.0)                   return 'bg-orange-400';
  return 'bg-ceitnot-danger';
}

/** Clamp HF to [0..3] and map to a 0–100% bar width */
export function hfBarPct(hf: number): number {
  if (!isFinite(hf)) return 100;
  return Math.min(100, Math.max(0, (hf / 3) * 100));
}

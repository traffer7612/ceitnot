import { formatUnits } from 'viem';

export const WAD         = 10n ** 18n;
export const MAX_UINT256 = 2n ** 256n - 1n;

/** Format a WAD (1e18) bigint as a human number string */
export function formatWad(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return '—';
  return Number(formatUnits(v, 18)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Format any token with its decimals */
export function formatToken(v: bigint | undefined, decimals = 18, dp = 4): string {
  if (v === undefined) return '—';
  return Number(formatUnits(v, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Format basis points as "X.XX%" */
export function formatBps(bps: bigint | undefined, dp = 2): string {
  if (bps === undefined) return '—';
  return (Number(bps) / 100).toFixed(dp) + '%';
}

/** Format a WAD rate as an annual % e.g. 0.05e18 → "5.00%" */
export function formatRate(v: bigint | undefined): string {
  if (v === undefined) return '—';
  return (Number(formatUnits(v, 18)) * 100).toFixed(2) + '%';
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
  if (!isFinite(hf) || hf >= 2.0) return 'text-aura-success';
  if (hf >= 1.5)                   return 'text-emerald-400';
  if (hf >= 1.2)                   return 'text-aura-warning';
  if (hf >= 1.0)                   return 'text-orange-400';
  return 'text-aura-danger';
}

/** Tailwind bg color class for HF bar fill */
export function hfBarColor(hf: number): string {
  if (!isFinite(hf) || hf >= 2.0) return 'bg-aura-success';
  if (hf >= 1.5)                   return 'bg-emerald-400';
  if (hf >= 1.2)                   return 'bg-aura-warning';
  if (hf >= 1.0)                   return 'bg-orange-400';
  return 'bg-aura-danger';
}

/** Clamp HF to [0..3] and map to a 0–100% bar width */
export function hfBarPct(hf: number): number {
  if (!isFinite(hf)) return 100;
  return Math.min(100, Math.max(0, (hf / 3) * 100));
}

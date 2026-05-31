import { parseUnits } from 'viem';
import { formatToken } from './utils';

function envHumanToWei(name: string, decimals: number): bigint | undefined {
  const raw = import.meta.env[name];
  if (raw === undefined || raw === '') return undefined;
  const s = String(raw).trim();
  if (!s || Number.isNaN(Number(s))) return undefined;
  try {
    return parseUnits(s, decimals);
  } catch {
    return undefined;
  }
}

/** Min of defined caps; undefined if neither is set. */
export function combineSwapLimits(
  onChain: bigint | undefined,
  envCap: bigint | undefined,
): bigint | undefined {
  if (onChain === undefined) return envCap;
  if (envCap === undefined) return onChain;
  return onChain < envCap ? onChain : envCap;
}

/** `VITE_PSM_MAX_SWAP_IN` in pegged-token units (e.g. 100 USDC). */
export function envMaxSwapInPeg(peggedDecimals: number): bigint | undefined {
  return envHumanToWei('VITE_PSM_MAX_SWAP_IN', peggedDecimals);
}

/** `VITE_PSM_MAX_SWAP_OUT` as ceitUSD wei (18 decimals). */
export function envMaxSwapOutAusd(_peggedDecimals: number, _scale: bigint): bigint | undefined {
  return envHumanToWei('VITE_PSM_MAX_SWAP_OUT', 18);
}

/** Remaining pegged-token headroom under PSM mint ceiling (swapIn). */
export function remainingPegFromCeiling(
  ceiling: bigint | undefined,
  mintedViaPsm: bigint | undefined,
  scale: bigint,
): bigint | undefined {
  if (ceiling === undefined || ceiling === 0n) return undefined;
  const minted = mintedViaPsm ?? 0n;
  if (minted >= ceiling) return 0n;
  const ausdLeft = ceiling - minted;
  if (scale <= 0n) return undefined;
  return ausdLeft / scale;
}

export function formatLimitHuman(
  value: bigint | undefined,
  decimals: number,
  symbol: string,
): string {
  if (value === undefined) return '—';
  return `${formatToken(value, decimals, 2)} ${symbol}`;
}

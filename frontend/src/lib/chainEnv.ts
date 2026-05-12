import { isAddress, type Address } from 'viem';

/** Single source for VITE_CHAIN_ID (wagmi + contract reads). */
function normalizeEnvString(raw: string | undefined): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t.replace(/^['"]+|['"]+$/g, '').trim();
}

export function parseEnvChainId(raw: string | undefined, fallback: number): number {
  const n = Number(normalizeEnvString(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const TARGET_CHAIN_ID = parseEnvChainId(import.meta.env.VITE_CHAIN_ID as string | undefined, 31337);

/**
 * Chain id for landing-page `/api/stats/:chainId` (wallet count). Defaults to Arbitrum One so production matches Railway
 * even when `VITE_CHAIN_ID` was never set on Vercel (otherwise it falls back to 31337 and hits the wrong stats route).
 * Override with `VITE_STATS_CHAIN_ID` (e.g. testnet).
 */
export const LANDING_STATS_CHAIN_ID = parseEnvChainId(
  import.meta.env.VITE_STATS_CHAIN_ID as string | undefined,
  42161,
);

/**
 * Safe address from Vite env: trim whitespace; reject empty / invalid strings.
 * Prevents wagmi/viem from throwing when .env has typos, quotes, or placeholders.
 */
export function viteAddress(raw: string | undefined): Address | undefined {
  const v = normalizeEnvString(raw);
  if (!v || !isAddress(v)) return undefined;
  return v as Address;
}

/** Prefer `primary` env; fall back to a secondary alias during address migrations. */
export function viteAddressLegacy(primary: string | undefined, legacy: string | undefined): Address | undefined {
  return viteAddress(primary) ?? viteAddress(legacy);
}

/**
 * Comma-separated market IDs to hide from dashboard / markets list / market picker (e.g. legacy broken oracle on testnet).
 * Users who still have collateral in a hidden market will still see that market in the picker and position cards.
 */
/** 8-decimal Chainlink-style USD price for mock ETH/USD (default 3000e8). Used when refreshing the Sepolia mock feed from the UI. */
export function viteMockEthUsd8Dec(): bigint {
  const raw = normalizeEnvString(import.meta.env.VITE_MOCK_ETH_USD_8DEC as string | undefined);
  if (raw) {
    try {
      return BigInt(raw);
    } catch {
      /* fall through */
    }
  }
  return 3000n * 10n ** 8n;
}

export function hiddenMarketIds(): Set<number> {
  const hidden = new Set<number>();
  // Production Arbitrum: hide iwstETH and legacy non-working iDAI markets from public lists.
  if (TARGET_CHAIN_ID === 42161) {
    hidden.add(2);
    hidden.add(3);
  }
  const raw = normalizeEnvString(import.meta.env.VITE_HIDDEN_MARKET_IDS as string | undefined);
  if (!raw) return hidden;
  raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0)
    .forEach(n => hidden.add(n));
  return hidden;
}

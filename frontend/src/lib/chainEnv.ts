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
const CHAIN_OVERRIDE_STORAGE_KEY = 'ceitnot:chainIdOverride';

export const APP_SUPPORTED_CHAIN_IDS = [42161, 421614, 11155111, 31337] as const;

function isSupportedChainId(chainId: number): boolean {
  return (APP_SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

function readChainOverride(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(CHAIN_OVERRIDE_STORAGE_KEY) ?? undefined;
  const n = Number(normalizeEnvString(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (!isSupportedChainId(n)) return undefined;
  return n;
}

export function setChainOverride(chainId: number | undefined) {
  if (typeof window === 'undefined') return;
  if (!chainId || !isSupportedChainId(chainId)) {
    window.localStorage.removeItem(CHAIN_OVERRIDE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(CHAIN_OVERRIDE_STORAGE_KEY, String(chainId));
}

const ENV_CHAIN_ID = parseEnvChainId(import.meta.env.VITE_CHAIN_ID as string | undefined, 31337);
const OVERRIDE_CHAIN_ID = readChainOverride();
export const TARGET_CHAIN_ID = OVERRIDE_CHAIN_ID ?? ENV_CHAIN_ID;

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

export type ContractAddressKey =
  | 'ENGINE'
  | 'REGISTRY'
  | 'GOVERNANCE_TOKEN'
  | 'VE_TOKEN'
  | 'GOVERNOR'
  | 'TIMELOCK'
  | 'CEITUSD'
  | 'AUSD'
  | 'PSM'
  | 'USDC'
  | 'TREASURY'
  | 'ORACLE_RELAY'
  | 'ROUTER'
  | 'MOCK_WSTETH'
  | 'MOCK_DAI'
  | 'WSTETH_VAULT';

const ADDRESS_ENV_KEYS: Record<ContractAddressKey, string[]> = {
  ENGINE: ['VITE_ENGINE_ADDRESS'],
  REGISTRY: ['VITE_REGISTRY_ADDRESS'],
  GOVERNANCE_TOKEN: ['VITE_GOVERNANCE_TOKEN_ADDRESS'],
  VE_TOKEN: ['VITE_VE_TOKEN_ADDRESS'],
  GOVERNOR: ['VITE_GOVERNOR_ADDRESS'],
  TIMELOCK: ['VITE_TIMELOCK_ADDRESS'],
  CEITUSD: ['VITE_CEITUSD_ADDRESS', 'VITE_AUSD_ADDRESS'],
  AUSD: ['VITE_AUSD_ADDRESS', 'VITE_CEITUSD_ADDRESS'],
  PSM: ['VITE_PSM_ADDRESS'],
  USDC: ['VITE_USDC_ADDRESS'],
  TREASURY: ['VITE_TREASURY_ADDRESS'],
  ORACLE_RELAY: ['VITE_ORACLE_RELAY'],
  ROUTER: ['VITE_ROUTER_ADDRESS'],
  MOCK_WSTETH: ['VITE_MOCK_WSTETH_ADDRESS', 'VITE_MOCK_WSTETH'],
  MOCK_DAI: ['VITE_MOCK_DAI_ADDRESS', 'VITE_MOCK_DAI'],
  WSTETH_VAULT: ['VITE_WSTETH_VAULT'],
};

const CHAIN_ADDRESS_BOOK_RAW: Record<number, Partial<Record<ContractAddressKey, string>>> = {
  // Arbitrum One
  42161: {
    ENGINE: '0xf8631eA8D16f67A4FfBAb691dcF55c6d0D31b928',
    REGISTRY: '0x41678342398f4827154120E8d7aA0c384B0c7015',
    GOVERNANCE_TOKEN: '0xe8388286545d6016BE38eE56710Ca768B7074826',
    VE_TOKEN: '0x6A18AC84a8E2cA9556556c1cDDa3bC4414414F28',
    GOVERNOR: '0x70DF0a55aCf6D2DC2C8C236DA6E2C602A8BC5cD1',
    TIMELOCK: '0x26A46142901F14196132Ea212970Cf13286Dc32D',
    CEITUSD: '0x01C169D51BA6a218B92af77D4c36eD17B5Ef2115',
    AUSD: '0x01C169D51BA6a218B92af77D4c36eD17B5Ef2115',
    PSM: '0xc3DeA5605DDEA1Cb768c040D5FD14ec6DedFbB54',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    TREASURY: '0x4D8FC1F286644c9098Eb39FBe0C7aCcbeCd9bc7D',
    ORACLE_RELAY: '0x9bD5ceAc5bB794a23703F3EdeC5e0822c60349c6',
    ROUTER: '0x3E4121d253f1513edB4b3077f613a5F37c8273F1',
  },
  // Arbitrum Sepolia
  421614: {
    ENGINE: '0x0348E674020edf3E90BD0F791DeCebe6EbD620b8',
    REGISTRY: '0x3cc54082707f608053B8F72537e59AAF2930DD1f',
    GOVERNANCE_TOKEN: '0x7b89AefB55292b037afaaA38a384f82f8aD61b08',
    VE_TOKEN: '0xDfD0d4eB67F2D770F8E7BdFF922fA0Eb0bA91b26',
    GOVERNOR: '0x2C7bE7279380Badb8b7Cbf7eCAa9Dd4aFbb4542A',
    TIMELOCK: '0x6a131aF25572fb0284D0E7397673e7c28153227e',
    CEITUSD: '0x29E3fee667D8ef595670F5086C6EDE567473fC87',
    AUSD: '0x29E3fee667D8ef595670F5086C6EDE567473fC87',
    PSM: '0x654cF9D17B8286edB581a706f24Dc4b4cFe686FB',
    USDC: '0x0Eed76f11eAdFfc01Ef6db1c2C178d3B383b8Cb4',
    TREASURY: '0x8ce693Bd576608fe0495fB2BBe1668d356409EC3',
    ORACLE_RELAY: '0x0aaAEf38c12039435e9DfD4009BD0079d3312dc4',
    ROUTER: '0xb7A77b5c3C48BF508dd5134D1C6f5B57Ffd130Ec',
    MOCK_WSTETH: '0x843989F6D1616812CDa58f54D8f8A37498e67FE3',
    WSTETH_VAULT: '0x6E829cFaA1cEAD52C76f27902517FBe8d22EFD2A',
  },
};

function envValue(key: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key];
}

export function contractAddress(key: ContractAddressKey, chainId: number = TARGET_CHAIN_ID): Address | undefined {
  const preferEnv = chainId === ENV_CHAIN_ID;
  if (preferEnv) {
    for (const envKey of ADDRESS_ENV_KEYS[key]) {
      const fromEnv = viteAddress(envValue(envKey));
      if (fromEnv) return fromEnv;
    }
  }
  const fromBook = viteAddress(CHAIN_ADDRESS_BOOK_RAW[chainId]?.[key]);
  if (fromBook) return fromBook;
  if (!preferEnv) {
    for (const envKey of ADDRESS_ENV_KEYS[key]) {
      const fromEnv = viteAddress(envValue(envKey));
      if (fromEnv) return fromEnv;
    }
  }
  return undefined;
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
  const raw = normalizeEnvString(import.meta.env.VITE_HIDDEN_MARKET_IDS as string | undefined);
  if (!raw) return hidden;
  raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0)
    .forEach(n => hidden.add(n));
  return hidden;
}

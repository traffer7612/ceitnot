import { getDefaultConfig, type WalletList } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { http, fallback } from 'wagmi';
import { defineChain } from 'viem';
import { arbitrum, hardhat, sepolia } from 'viem/chains';
import type { Chain } from 'viem/chains';
import { APP_SUPPORTED_CHAIN_IDS, TARGET_CHAIN_ID } from './lib/chainEnv';

/** Arbitrum Sepolia (not always exported in older viem/chains). */
export const arbitrumSepolia = defineChain({
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' },
  },
});

function chainFor(id: number): Chain {
  switch (id) {
    case 42161:
      return arbitrum;
    case 421614:
      return arbitrumSepolia;
    case 11155111:
      return sepolia;
    case 31337:
    case 1337:
      return hardhat;
    default:
      return hardhat;
  }
}

/** Active chain from `VITE_CHAIN_ID` (RainbowKit / wagmi). */
export const targetChain = chainFor(TARGET_CHAIN_ID);
export const supportedChains = APP_SUPPORTED_CHAIN_IDS.map(chainFor) as [Chain, ...Chain[]];
export const SUPPORTED_CHAIN_IDS = supportedChains.map((c) => c.id) as readonly number[];
const FALLBACK_WALLETCONNECT_PROJECT_ID = '00000000000000000000000000000000';

function normalizeEnvString(raw: string | undefined): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t.replace(/^['"]+|['"]+$/g, '').trim();
}
function envFlagEnabled(raw: string | undefined): boolean {
  const v = normalizeEnvString(raw).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
function walletConnectProjectIdFromEnv(raw: string | undefined): string | undefined {
  const v = normalizeEnvString(raw);
  if (!/^[a-f0-9]{32}$/i.test(v)) return undefined;
  return v;
}

const walletConnectProjectId = walletConnectProjectIdFromEnv(
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined,
);
const walletConnectEnabled =
  envFlagEnabled(import.meta.env.VITE_ENABLE_WALLETCONNECT as string | undefined) &&
  Boolean(walletConnectProjectId);
const injectedOnlyWallets: WalletList = [
  {
    groupName: 'Browser wallet',
    wallets: [injectedWallet],
  },
];

const PUBLIC_ARBITRUM_RPCS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.gateway.tenderly.co',
  'https://arbitrum-one.publicnode.com',
] as const;

const PUBLIC_SEPOLIA_RPCS = [
  'https://ethereum-sepolia.publicnode.com',
  'https://rpc.sepolia.org',
  'https://sepolia.drpc.org',
] as const;

const PUBLIC_ARBITRUM_SEPOLIA_RPCS = [
  'https://sepolia-rollup.arbitrum.io/rpc',
  'https://arbitrum-sepolia-rpc.publicnode.com',
  'https://arbitrum-sepolia.drpc.org',
  'https://endpoints.omniatech.io/v1/arbitrum/sepolia/public',
] as const;

function validHttpUrl(s: string | undefined): string | undefined {
  const t = s?.trim();
  const unquoted = t?.replace(/^['"]+|['"]+$/g, '').trim();
  if (unquoted && /^https?:\/\//i.test(unquoted)) return unquoted;
  return undefined;
}

function uniqueUrls(urls: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
function isKnownCorsUnsafeRpc(url: string, chainId: number): boolean {
  void chainId;
  void url;
  return false;
}
function isDeprioritizedRpc(url: string, chainId: number): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('infura.io') && (chainId === 421614 || chainId === 11155111)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function useDevRpcProxy(): boolean {
  if (!import.meta.env.DEV) return false;
  const raw = String(import.meta.env.VITE_USE_RPC_PROXY ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function fallbackHttp(urls: readonly string[]) {
  const transports = urls.map((url) => http(url, { retryCount: 0, timeout: 20_000 }));
  if (transports.length === 1) return transports[0];
  return fallback(transports);
}
function deriveArbitrumSepoliaRpc(rawArbitrumRpc: string | undefined): string | undefined {
  if (!rawArbitrumRpc) return undefined;
  try {
    const u = new URL(rawArbitrumRpc);
    if (u.hostname === 'arbitrum-sepolia.infura.io') return u.toString();
    if (u.hostname === 'arbitrum-mainnet.infura.io') {
      u.hostname = 'arbitrum-sepolia.infura.io';
      return u.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function transportFromUrls(chainId: number, primaryCandidates: readonly (string | undefined)[], publicUrls: readonly string[]) {
  const discoveredUrls = uniqueUrls([...primaryCandidates, ...publicUrls]).filter((url) => !isKnownCorsUnsafeRpc(url, chainId));
  const prioritizedUrls = discoveredUrls.filter((url) => !isDeprioritizedRpc(url, chainId));
  const deprioritizedUrls = discoveredUrls.filter((url) => isDeprioritizedRpc(url, chainId));
  const allUrls = [...prioritizedUrls, ...deprioritizedUrls];
  const withProxyFallback = useDevRpcProxy();
  if (allUrls.length === 0) {
    if (withProxyFallback) return fallbackHttp(['/rpc']);
    return fallbackHttp([publicUrls[0]]);
  }
  if (withProxyFallback) {
    return fallbackHttp([...allUrls, '/rpc']);
  }
  return fallbackHttp(allUrls);
}

function transportFor(chainId: number) {
  if (chainId === 42161) {
    const raw = validHttpUrl(import.meta.env.VITE_ARBITRUM_RPC_URL as string | undefined);
    return transportFromUrls(chainId, [raw], PUBLIC_ARBITRUM_RPCS);
  }
  if (chainId === 421614) {
    const rawSepolia = validHttpUrl(import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC_URL as string | undefined);
    const rawArbitrum = validHttpUrl(import.meta.env.VITE_ARBITRUM_RPC_URL as string | undefined);
    const derivedSepoliaFromArbitrum = deriveArbitrumSepoliaRpc(rawArbitrum);
    return transportFromUrls(chainId, [rawSepolia, derivedSepoliaFromArbitrum], PUBLIC_ARBITRUM_SEPOLIA_RPCS);
  }
  if (chainId === 11155111) {
    const raw = validHttpUrl(import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined);
    return transportFromUrls(chainId, [raw], PUBLIC_SEPOLIA_RPCS);
  }
  return http('http://127.0.0.1:8545');
}

export const config = getDefaultConfig({
  appName: 'Ceitnot Protocol',
  projectId: walletConnectProjectId ?? FALLBACK_WALLETCONNECT_PROJECT_ID,
  wallets: walletConnectEnabled ? undefined : injectedOnlyWallets,
  chains: supportedChains,
  transports: Object.fromEntries(
    supportedChains.map((chain) => [chain.id, transportFor(chain.id)]),
  ),
  ssr: false,
});

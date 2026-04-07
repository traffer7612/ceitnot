import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http, fallback } from 'wagmi';
import { defineChain } from 'viem';
import { arbitrum, hardhat, sepolia } from 'viem/chains';
import type { Chain } from 'viem/chains';
import { TARGET_CHAIN_ID } from './lib/chainEnv';

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

export const SUPPORTED_CHAIN_IDS = [targetChain.id] as const;

const PUBLIC_ARBITRUM_RPCS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum-one.publicnode.com',
  'https://arbitrum.drpc.org',
] as const;

const PUBLIC_SEPOLIA_RPCS = [
  'https://ethereum-sepolia.publicnode.com',
  'https://rpc.sepolia.org',
  'https://sepolia.drpc.org',
] as const;

const PUBLIC_ARBITRUM_SEPOLIA_RPCS = [
  'https://sepolia-rollup.arbitrum.io/rpc',
  'https://arbitrum-sepolia.publicnode.com',
] as const;

function validHttpUrl(s: string | undefined): string | undefined {
  const t = s?.trim();
  if (t && /^https?:\/\//i.test(t)) return t;
  return undefined;
}

/**
 * Dev: `/rpc` → Vite proxy (see vite.config.ts), matches `VITE_CHAIN_ID`.
 * Prod: optional `VITE_ARBITRUM_RPC_URL` / `VITE_SEPOLIA_RPC_URL` / `VITE_ARBITRUM_SEPOLIA_RPC_URL`, else public fallbacks.
 */
function transportFor(chainId: number) {
  if (chainId === 42161) {
    const raw = validHttpUrl(import.meta.env.VITE_ARBITRUM_RPC_URL as string | undefined);
    if (raw) return http(raw);
    if (import.meta.env.DEV) return http('/rpc');
    return fallback(PUBLIC_ARBITRUM_RPCS.map((url) => http(url)));
  }
  if (chainId === 421614) {
    const raw = validHttpUrl(import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC_URL as string | undefined);
    if (raw) return http(raw);
    if (import.meta.env.DEV) return http('/rpc');
    return fallback(PUBLIC_ARBITRUM_SEPOLIA_RPCS.map((url) => http(url)));
  }
  if (chainId === 11155111) {
    const raw = validHttpUrl(import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined);
    if (raw) return http(raw);
    if (import.meta.env.DEV) return http('/rpc');
    return fallback(PUBLIC_SEPOLIA_RPCS.map((url) => http(url)));
  }
  return http('http://127.0.0.1:8545');
}

export const config = getDefaultConfig({
  appName: 'Ceitnot Protocol',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'ceitnot-dev-placeholder',
  chains: [targetChain],
  transports: {
    [targetChain.id]: transportFor(targetChain.id),
  },
  ssr: false,
});

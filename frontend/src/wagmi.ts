import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http, fallback } from 'wagmi';
import { sepolia } from 'viem/chains';

// Supported chains: Sepolia testnet
export const SUPPORTED_CHAIN_IDS = [sepolia.id] as const;

/** Public Sepolia HTTP endpoints (no API key). Tried in order by viem fallback. */
const PUBLIC_SEPOLIA_RPCS = [
  'https://ethereum-sepolia.publicnode.com',
  'https://rpc.sepolia.org',
  'https://sepolia.drpc.org',
] as const;

/**
 * Dev: Vite proxies /rpc → publicnode (vite.config.ts).
 * Prod: fallback across public RPCs. Optional VITE_SEPOLIA_RPC_URL (https://…) overrides all.
 */
function sepoliaTransport() {
  const raw = (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined)?.trim();
  if (raw && /^https?:\/\//i.test(raw)) return http(raw);
  if (import.meta.env.DEV) return http('/rpc');
  return fallback(PUBLIC_SEPOLIA_RPCS.map((url) => http(url)));
}

export const config = getDefaultConfig({
  appName: 'Aura Protocol',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'aura-dev-placeholder',
  chains: [sepolia],
  transports: {
    [sepolia.id]: sepoliaTransport(),
  },
  ssr: false,
});

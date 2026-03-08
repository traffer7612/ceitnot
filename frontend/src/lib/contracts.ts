import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { auraEngineAbi } from '../abi/auraEngine';

/** Target chain for all contract reads (from .env or default Foundry) */
export const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);

async function fetchFromApi(): Promise<{ engine?: string; registry?: string }> {
  try {
    const res = await fetch('/api/config/contracts');
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

/**
 * Returns contract addresses.
 * Priority: VITE_* env vars > /api/config/contracts > engine.marketRegistry() on-chain
 */
export function useContractAddresses() {
  const envEngine   = import.meta.env.VITE_ENGINE_ADDRESS   as Address | undefined;
  const envRegistry = import.meta.env.VITE_REGISTRY_ADDRESS as Address | undefined;
  const hasEnvRegistry = !!envRegistry;

  const { data: apiData, isLoading: apiLoading } = useQuery({
    queryKey: ['contracts-config'],
    queryFn: fetchFromApi,
    enabled: !envEngine,
    staleTime: Infinity,
    retry: false,
  });

  const engine = (envEngine ?? apiData?.engine as Address | undefined);

  // Auto-discover registry from engine.marketRegistry() if not set via env/api
  const apiRegistry = apiData?.registry as Address | undefined;
  const needsOnChainRegistry = !!engine && !hasEnvRegistry && !apiRegistry;
  const { data: onChainRegistry } = useReadContract({
    address: engine,
    abi: auraEngineAbi,
    functionName: 'marketRegistry',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: needsOnChainRegistry, staleTime: Infinity },
  });

  const registry = (envRegistry ?? apiRegistry ?? onChainRegistry) as Address | undefined;

  return {
    engine,
    registry,
    isLoading: (!envEngine && apiLoading),
  };
}

/** Gas override helpers per chain */
export function gasFor(chainId: number | undefined) {
  if (chainId === 31337 || chainId === 1337) return { gas: 8_000_000n };
  if (chainId === 42161)                     return { gas: 300_000n };
  if (chainId === 11155111)                  return { gas: 500_000n };
  return {};
}

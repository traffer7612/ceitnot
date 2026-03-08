import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';

async function fetchFromApi(): Promise<{ engine?: string }> {
  try {
    const res = await fetch('/api/config/contracts');
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

/**
 * Returns contract addresses, preferring VITE_* env vars and falling back
 * to the /api/config/contracts proxy endpoint.
 */
export function useContractAddresses() {
  const envEngine   = import.meta.env.VITE_ENGINE_ADDRESS   as Address | undefined;
  const envRegistry = import.meta.env.VITE_REGISTRY_ADDRESS as Address | undefined;
  const hasAll = !!envEngine && !!envRegistry;

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['contracts-config'],
    queryFn: fetchFromApi,
    enabled: !hasAll,
    staleTime: Infinity,
    retry: false,
  });

  return {
    engine:    (envEngine   ?? apiData?.engine   as Address | undefined),
    registry:  (envRegistry ?? undefined)         as Address | undefined,
    isLoading: !hasAll && isLoading,
  };
}

/** Gas override helpers per chain */
export function gasFor(chainId: number | undefined) {
  if (chainId === 31337 || chainId === 1337) return { gas: 8_000_000n };
  if (chainId === 42161)                     return { gas: 300_000n };
  if (chainId === 11155111)                  return { gas: 500_000n };
  return {};
}

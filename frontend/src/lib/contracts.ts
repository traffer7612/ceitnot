import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { ceitnotEngineAbi } from '../abi/ceitnotEngine';
import { TARGET_CHAIN_ID, contractAddress } from './chainEnv';
import { apiUrl } from './apiOrigin';

export { TARGET_CHAIN_ID };

async function fetchFromApi(): Promise<{ engine?: string; registry?: string }> {
  try {
    const res = await fetch(apiUrl('/api/config/contracts'));
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

/**
 * Returns contract addresses.
 * Priority: chain-aware address book (with env fallback) > /api/config/contracts > engine.marketRegistry() on-chain
 */
export function useContractAddresses() {
  const envEngine   = contractAddress('ENGINE');
  const envRegistry = contractAddress('REGISTRY');
  const hasEnvRegistry = !!envRegistry;

  const { data: apiData, isLoading: apiLoading } = useQuery({
    queryKey: ['contracts-config', TARGET_CHAIN_ID],
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
    abi: ceitnotEngineAbi,
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

/**
 * Gas + EIP-1559 hints per chain.
 * On Arbitrum L2, explicit fee overrides can be misinterpreted by some wallet paths,
 * producing absurd fee previews. Let the wallet estimate by default.
 */
export function gasFor(chainId: number | undefined) {
  if (chainId === 31337 || chainId === 1337) return { gas: 8_000_000n };
  if (chainId === 42161 || chainId === 421614) return {};
  if (chainId === 11155111) {
    return { gas: 500_000n };
  }
  return {};
}

/**
 * EIP-1559 hints for simple ERC-20 `approve` (no explicit gas limit).
 */
export function gasForTokenApprove(chainId: number | undefined) {
  if (chainId === 42161 || chainId === 421614) return {};
  if (chainId === 11155111) return {};
  return {};
}

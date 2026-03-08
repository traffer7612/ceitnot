import { useReadContract, useReadContracts } from 'wagmi';
import { auraEngineAbi, auraRegistryAbi, erc20Abi, type MarketConfig } from '../abi/auraEngine';
import { useContractAddresses } from '../lib/contracts';

export type Market = {
  id: number;
  config: MarketConfig;
  totalDebt: bigint;
  totalCollateral: bigint;
  vaultSymbol?: string;
};

export function useMarkets() {
  const { engine, registry } = useContractAddresses();

  // 1. Market count from registry
  const { data: countRaw } = useReadContract({
    address: registry,
    abi: auraRegistryAbi,
    functionName: 'marketCount',
    query: { enabled: !!registry },
  });
  const count = Number(countRaw ?? 0n);

  // 2. Market configs from registry
  const { data: configResults, isLoading: configLoading, refetch: refetchConfigs } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: registry!,
      abi: auraRegistryAbi,
      functionName: 'getMarket' as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: !!registry && count > 0 },
  });

  // 3. Engine stats (totalDebt + totalCollateralAssets per market)
  const { data: statsResults, refetch: refetchStats } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => [
      { address: engine!, abi: auraEngineAbi, functionName: 'totalDebt' as const, args: [BigInt(i)] as const },
      { address: engine!, abi: auraEngineAbi, functionName: 'totalCollateralAssets' as const, args: [BigInt(i)] as const },
    ]).flat(),
    query: { enabled: !!engine && count > 0 },
  });

  // 4. Vault symbols
  const vaultAddresses = configResults?.map(r => r.result?.vault).filter(Boolean) ?? [];
  const { data: symbolResults } = useReadContracts({
    contracts: vaultAddresses.map(addr => ({
      address: addr!,
      abi: erc20Abi,
      functionName: 'symbol' as const,
    })),
    query: { enabled: vaultAddresses.length > 0 },
  });

  // Build the markets array
  const rawMarkets = Array.from({ length: count }, (_, i) => {
    const config = configResults?.[i]?.result as MarketConfig | undefined;
    if (!config) return null;
    return {
      id: i,
      config,
      totalDebt:       (statsResults?.[i * 2]?.result as bigint | undefined)     ?? 0n,
      totalCollateral: (statsResults?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n,
      vaultSymbol:     (symbolResults?.[i]?.result as string | undefined),
    };
  });
  const markets: Market[] = rawMarkets.filter((m): m is NonNullable<typeof m> => m !== null);

  const refetch = () => { refetchConfigs(); refetchStats(); };

  return { markets, count, isLoading: configLoading, refetch };
}

import { useReadContract, useReadContracts } from 'wagmi';
import { ceitnotEngineAbi, marketRegistryAbi, erc20Abi, erc4626Abi, type MarketConfig } from '../abi/ceitnotEngine';
import { useContractAddresses, TARGET_CHAIN_ID } from '../lib/contracts';
import { hiddenMarketIds } from '../lib/chainEnv';
import { erc20Decimals } from '../lib/utils';
import type { Address } from 'viem';

const LIDO_WSTETH_ARB = '0x5979D7b546E38E414F7E9822514be443A4800529' as Address;

export type Market = {
  id: number;
  config: MarketConfig;
  totalDebt: bigint;
  totalCollateral: bigint;
  vaultSymbol?: string;
  vaultAsset?: Address;
  hasNonCanonicalWstEthAsset?: boolean;
  /** ERC-4626 vault share decimals (= underlying for OZ ERC4626; e.g. 6 for USDC). */
  vaultDecimals?: number;
};

export function useMarkets() {
  const { engine, registry } = useContractAddresses();

  // 1. Market count from registry
  const { data: countRaw, isLoading: countLoading } = useReadContract({
    address: registry,
    abi: marketRegistryAbi,
    functionName: 'marketCount',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!registry },
  });
  const count = Number(countRaw ?? 0n);

  // 2. Market configs from registry
  const { data: configResults, isLoading: configLoading, refetch: refetchConfigs } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: registry!,
      abi: marketRegistryAbi,
      functionName: 'getMarket' as const,
      args: [BigInt(i)] as const,
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: !!registry && count > 0 },
  });

  // 3. Engine stats (totalDebt + totalCollateralAssets per market)
  const { data: statsResults, refetch: refetchStats } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => [
      { address: engine!, abi: ceitnotEngineAbi, functionName: 'totalDebt' as const, args: [BigInt(i)] as const, chainId: TARGET_CHAIN_ID },
      { address: engine!, abi: ceitnotEngineAbi, functionName: 'totalCollateralAssets' as const, args: [BigInt(i)] as const, chainId: TARGET_CHAIN_ID },
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
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: vaultAddresses.length > 0 },
  });

  const { data: vaultDecimalsResults } = useReadContracts({
    contracts: vaultAddresses.map(addr => ({
      address: addr!,
      abi: erc20Abi,
      functionName: 'decimals' as const,
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: vaultAddresses.length > 0 },
  });

  const { data: vaultAssetResults } = useReadContracts({
    contracts: vaultAddresses.map(addr => ({
      address: addr!,
      abi: erc4626Abi,
      functionName: 'asset' as const,
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: vaultAddresses.length > 0 },
  });

  // Build the markets array
  const rawMarkets = Array.from({ length: count }, (_, i) => {
    const config = configResults?.[i]?.result as MarketConfig | undefined;
    if (!config) return null;
    const vaultSymbol = (symbolResults?.[i]?.result as string | undefined);
    const vaultAsset = (vaultAssetResults?.[i]?.result as Address | undefined);
    const hasNonCanonicalWstEthAsset =
      TARGET_CHAIN_ID === 42161
      && !!vaultSymbol
      && /wsteth/i.test(vaultSymbol)
      && !!vaultAsset
      && vaultAsset.toLowerCase() !== LIDO_WSTETH_ARB.toLowerCase();
    return {
      id: i,
      config,
      totalDebt:       (statsResults?.[i * 2]?.result as bigint | undefined)     ?? 0n,
      totalCollateral: (statsResults?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n,
      vaultSymbol,
      vaultAsset,
      hasNonCanonicalWstEthAsset,
      vaultDecimals:
        vaultDecimalsResults?.[i]?.status === 'success'
          ? erc20Decimals(vaultDecimalsResults?.[i]?.result as number | bigint | undefined)
          : undefined,
    };
  });
  const markets: Market[] = rawMarkets.filter((m): m is NonNullable<typeof m> => m !== null);

  const hidden = hiddenMarketIds();
  const browseMarkets = markets.filter(
    m => m.config.isActive && !m.config.isFrozen && !hidden.has(m.id) && !m.hasNonCanonicalWstEthAsset,
  );

  const refetch = () => { refetchConfigs(); refetchStats(); };

  return { markets, browseMarkets, count, isLoading: countLoading || configLoading, refetch };
}
